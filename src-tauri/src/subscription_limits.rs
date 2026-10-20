use crate::live_limits::{
    window, LimitError, LimitWindow, Provider, ProviderLimits, SubscriptionWindow,
};
use serde_json::Value;

// Only explicit subscription gauges are admitted. In particular, do not use
// context fullness, API rate limits, spend budgets or purchased credit balances.
pub(crate) fn parse(provider: Provider, output: &[u8]) -> Result<ProviderLimits, LimitError> {
    let payload: Value = serde_json::from_slice(output).map_err(|_| LimitError::ProviderData)?;
    let snapshots = payload
        .get("snapshots")
        .and_then(Value::as_array)
        .ok_or(LimitError::ProviderData)?;
    let mut first_error = None;
    for snapshot in snapshots
        .iter()
        .filter(|s| s.get("provider_id").and_then(Value::as_str) == Some(provider.id()))
    {
        match parse_snapshot(provider, snapshot) {
            Ok(windows) => {
                return Ok(ProviderLimits {
                    status: "ok",
                    source: "OpenUsage",
                    checked_at: chrono::Utc::now().to_rfc3339(),
                    five_hour: windows
                        .iter()
                        .find(|w| w.kind == "fiveHour")
                        .map(|w| w.limit.clone()),
                    weekly: windows
                        .iter()
                        .find(|w| w.kind == "weekly")
                        .map(|w| w.limit.clone()),
                    windows,
                    message: None,
                    error_code: None,
                });
            }
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    Err(first_error.unwrap_or(LimitError::ProviderData))
}

fn parse_snapshot(
    provider: Provider,
    snapshot: &Value,
) -> Result<Vec<SubscriptionWindow>, LimitError> {
    let status = snapshot.get("status").and_then(Value::as_str).unwrap_or("");
    if status == "AUTH_REQUIRED" {
        return Err(LimitError::ProviderAuth);
    }
    if status == "ERROR" {
        return Err(classify(snapshot));
    }
    // Free and unlimited allowances are not substituted for a paid quota.
    if [
        "copilot_plan",
        "plan_type",
        "plan",
        "plan_name",
        "plan_tier",
    ]
    .iter()
    .any(|key| {
        snapshot
            .get("attributes")
            .and_then(|attrs| attrs.get(key))
            .and_then(Value::as_str)
            .is_some_and(|value| {
                matches!(
                    value.to_ascii_lowercase().as_str(),
                    "free" | "hobby" | "inactive_or_free"
                )
            })
    }) {
        return Err(LimitError::ProviderData);
    }

    let specs: &[(&str, &str, &str)] = match provider {
        Provider::Zai | Provider::CommandCode => &[
            ("usage_five_hour", "5時間", "fiveHour"),
            ("usage_seven_day", "週間", "weekly"),
        ],
        Provider::KimiCli => &[
            ("usage_five_hour", "5時間", "fiveHour"),
            ("usage_monthly", "月間", "monthly"),
            ("usage_monthly_code", "Code月間", "monthly"),
        ],
        Provider::Opencode => &[
            ("rolling_usage", "5時間", "fiveHour"),
            ("weekly_usage", "週間", "weekly"),
            ("monthly_usage_pct", "月間", "monthly"),
        ],
        Provider::Copilot => &[("premium_interactions_quota", "月間", "monthly")],
        Provider::Cursor => &[("plan_percent_used", "契約期間", "monthly")],
        Provider::Antigravity => return antigravity_windows(snapshot),
        _ => return Err(LimitError::ProviderData),
    };
    let windows: Vec<_> = specs
        .iter()
        .filter_map(|&(key, label, kind)| {
            let metric = snapshot.get("metrics")?.get(key)?;
            metric_window(metric, reset_value(snapshot, key)).map(|limit| SubscriptionWindow {
                id: key.to_owned(),
                label,
                kind,
                limit,
            })
        })
        .collect();
    if windows.is_empty() {
        Err(classify(snapshot))
    } else {
        Ok(windows)
    }
}

fn reset_value(snapshot: &Value, key: &str) -> Option<Value> {
    let resets = snapshot.get("resets")?;
    let value = resets
        .get(key)
        .or_else(|| resets.get(format!("{key}_reset")))
        .or_else(|| {
            (key == "premium_interactions_quota")
                .then(|| resets.get("quota_reset"))
                .flatten()
        })
        .or_else(|| {
            (key == "plan_percent_used")
                .then(|| resets.get("billing_cycle_end"))
                .flatten()
        })?;
    // Do not fabricate a reset. Normalize only parseable, provider-returned dates.
    if let Some(text) = value.as_str() {
        return chrono::DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|date| Value::String(date.to_rfc3339()));
    }
    let epoch = value.as_i64()?;
    let seconds = if epoch > 10_000_000_000 {
        epoch / 1000
    } else {
        epoch
    };
    chrono::DateTime::from_timestamp(seconds, 0).map(|date| Value::String(date.to_rfc3339()))
}

fn metric_window(metric: &Value, reset: Option<Value>) -> Option<LimitWindow> {
    let unit = metric.get("unit").and_then(Value::as_str)?;
    if unit == "%" || unit == "percent" {
        if let Some(used) = metric.get("used").and_then(Value::as_f64) {
            return window(Some(used), reset);
        }
        return window(
            metric
                .get("remaining")
                .and_then(Value::as_f64)
                .map(|remaining| 100.0 - remaining),
            reset,
        );
    }
    // Copilot may supply exact remaining/entitlement request counts instead.
    if unit != "requests" {
        return None;
    }
    let limit = metric
        .get("limit")
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && *v > 0.0)?;
    let used = metric
        .get("remaining")
        .and_then(Value::as_f64)
        .map(|v| limit - v)
        .or_else(|| metric.get("used").and_then(Value::as_f64))?;
    if !used.is_finite() || !(0.0..=limit).contains(&used) {
        return None;
    }
    window(Some(used / limit * 100.0), reset)
}

fn antigravity_windows(snapshot: &Value) -> Result<Vec<SubscriptionWindow>, LimitError> {
    let timestamp = snapshot
        .get("timestamp")
        .and_then(Value::as_str)
        .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
        .ok_or(LimitError::ProviderData)?;
    let age = chrono::Utc::now().signed_duration_since(timestamp);
    if age > chrono::Duration::minutes(5) || age < chrono::Duration::minutes(-5) {
        return Err(LimitError::ProviderStale);
    }
    let metrics = snapshot
        .get("metrics")
        .and_then(Value::as_object)
        .ok_or(LimitError::ProviderData)?;
    let selected = metrics
        .iter()
        .filter(|(key, _)| key.starts_with("quota_"))
        .filter_map(|(key, metric)| metric_window(metric, reset_value(snapshot, key)))
        .min_by(|a, b| a.remaining_percent.total_cmp(&b.remaining_percent))
        .ok_or(LimitError::ProviderData)?;
    Ok(vec![SubscriptionWindow {
        id: "model_quota".to_owned(),
        label: "モデル",
        kind: "other",
        limit: selected,
    }])
}

fn classify(snapshot: &Value) -> LimitError {
    let diagnostic = snapshot
        .get("diagnostics")
        .and_then(Value::as_object)
        .map(|items| {
            items
                .values()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ")
                .to_ascii_lowercase()
        })
        .unwrap_or_default();
    if diagnostic.contains("429") || diagnostic.contains("rate limit") {
        LimitError::ProviderRateLimited
    } else if diagnostic.contains("401")
        || diagnostic.contains("403")
        || diagnostic.contains("expired")
        || diagnostic.contains("credentials")
    {
        LimitError::ProviderAuth
    } else if diagnostic.contains("500") || diagnostic.contains("502") || diagnostic.contains("503")
    {
        LimitError::ProviderServer
    } else {
        LimitError::ProviderData
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse_one(provider: Provider, snapshot: Value) -> Result<ProviderLimits, LimitError> {
        parse(
            provider,
            &serde_json::to_vec(&json!({"snapshots": [snapshot]})).unwrap(),
        )
    }

    #[test]
    fn admits_only_subscription_metrics_and_preserves_real_resets() {
        for provider in [Provider::Zai, Provider::CommandCode] {
            let result = parse_one(provider, json!({"provider_id": provider.id(), "status": "OK", "metrics": {
                "usage_five_hour": {"used": 0, "unit": "%"}, "usage_seven_day": {"used": 100, "unit": "%"},
                "credit_balance": {"remaining": 1000, "limit": 1000, "unit": "USD"}, "rpm": {"remaining": 10, "limit": 20, "unit": "requests"}
            }, "resets": {"usage_five_hour": "2026-10-21T01:00:00Z"}})).unwrap();
            assert_eq!(result.windows.len(), 2);
            assert_eq!(result.five_hour.unwrap().remaining_percent, 100.0);
            assert_eq!(result.weekly.unwrap().remaining_percent, 0.0);
            assert_eq!(
                result.windows[0].limit.resets_at,
                Some(json!("2026-10-21T01:00:00+00:00"))
            );
        }
    }

    #[test]
    fn monthly_windows_are_not_mislabeled_as_weekly() {
        for (provider, key) in [
            (Provider::KimiCli, "usage_monthly"),
            (Provider::Opencode, "monthly_usage_pct"),
            (Provider::Cursor, "plan_percent_used"),
        ] {
            let result = parse_one(provider, json!({"provider_id": provider.id(), "metrics": {key: {"used": 25, "unit": "%"}}, "resets": {format!("{key}_reset"): "2026-11-01T00:00:00Z"}})).unwrap();
            assert!(result.weekly.is_none());
            assert!(result.five_hour.is_none());
            assert_eq!(result.windows[0].kind, "monthly");
            assert_eq!(result.windows[0].limit.remaining_percent, 75.0);
        }
    }

    #[test]
    fn rejects_unknown_limits_invalid_values_free_plans_and_api_balances() {
        for metric in [
            json!({"used": 101, "unit": "%"}),
            json!({"used": -1, "unit": "%"}),
            json!({"remaining": 30, "unit": "requests"}),
            json!({"remaining": 50, "limit": 100, "unit": "USD"}),
        ] {
            assert!(parse_one(
                Provider::Copilot,
                json!({"provider_id": "copilot", "metrics": {"premium_interactions_quota": metric}})
            )
            .is_err());
        }
        assert!(parse_one(Provider::Copilot, json!({"provider_id": "copilot", "attributes": {"copilot_plan": "free"}, "metrics": {"premium_interactions_quota": {"used": 10, "unit": "%"}}})).is_err());
        assert!(parse_one(Provider::Cursor, json!({"provider_id": "cursor", "metrics": {"spend_limit": {"used": 10, "limit": 100, "unit": "USD"}}})).is_err());
    }

    #[test]
    fn copilot_uses_entitlement_without_using_github_api_limits() {
        let result = parse_one(
            Provider::Copilot,
            json!({"provider_id": "copilot", "metrics": {
                "premium_interactions_quota": {"remaining": 240, "limit": 300, "unit": "requests"},
                "gh_core_rpm": {"remaining": 1, "limit": 5000, "unit": "requests"}
            }}),
        )
        .unwrap();
        assert_eq!(result.windows.len(), 1);
        assert_eq!(result.windows[0].limit.remaining_percent, 80.0);
    }

    #[test]
    fn accepts_opencode_percent_units_and_cursor_billing_reset() {
        let opencode = parse_one(
            Provider::Opencode,
            json!({"provider_id": "opencode", "metrics": {
                "rolling_usage": {"used": 0, "limit": 100, "unit": "percent"},
                "weekly_usage": {"used": 35, "limit": 100, "unit": "percent"},
                "monthly_usage_pct": {"used": 60, "limit": 100, "unit": "percent"},
                "console_balance": {"remaining": 12, "unit": "USD"}
            }}),
        )
        .unwrap();
        assert_eq!(opencode.windows.len(), 3);
        assert_eq!(opencode.five_hour.unwrap().remaining_percent, 100.0);
        assert_eq!(opencode.weekly.unwrap().remaining_percent, 65.0);
        let cursor = parse_one(
            Provider::Cursor,
            json!({"provider_id": "cursor", "metrics": {
            "plan_percent_used": {"used": 25, "unit": "%"}
        }, "resets": {"billing_cycle_end": "2026-11-01T00:00:00Z"}}),
        )
        .unwrap();
        assert_eq!(
            cursor.windows[0].limit.resets_at,
            Some(json!("2026-11-01T00:00:00+00:00"))
        );
    }

    #[test]
    fn selects_one_account_without_combining_windows_or_exposing_diagnostics() {
        let result = parse(Provider::Zai, &serde_json::to_vec(&json!({"snapshots": [
            {"provider_id": "zai", "status": "AUTH_REQUIRED", "diagnostics": {"reason": "private-detail"}},
            {"provider_id": "zai", "metrics": {"usage_five_hour": {"used": 20, "unit": "%"}}},
            {"provider_id": "zai", "metrics": {"usage_seven_day": {"used": 40, "unit": "%"}}}
        ]})).unwrap()).unwrap();
        assert!(result.weekly.is_none());
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains("private-detail"));
    }

    #[test]
    fn antigravity_uses_real_model_quota_and_rejects_expired_feeds() {
        let mut snapshot = json!({"provider_id": "antigravity", "timestamp": chrono::Utc::now().to_rfc3339(), "metrics": {
            "context_window": {"used": 99, "unit": "%"}, "quota_pro": {"remaining": 72, "unit": "%"}, "quota_flash": {"remaining": 80, "unit": "%"}
        }});
        let result = parse_one(Provider::Antigravity, snapshot.clone()).unwrap();
        assert_eq!(result.windows[0].limit.remaining_percent, 72.0);
        assert!(result.windows[0].limit.resets_at.is_none());
        snapshot["timestamp"] =
            json!((chrono::Utc::now() - chrono::Duration::minutes(6)).to_rfc3339());
        assert_eq!(
            parse_one(Provider::Antigravity, snapshot).unwrap_err(),
            LimitError::ProviderStale
        );
    }
}

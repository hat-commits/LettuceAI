use chrono::{
    DateTime, Datelike, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc,
};
use regex::Regex;
use std::sync::OnceLock;

use crate::chat_manager::types::{MemoryEmbedding, Session};

#[derive(Clone, Debug)]
pub struct TemporalRange {
    pub start_ms: u64,
    pub end_ms: u64,
}

fn local_datetime_from_ms(ms: u64) -> DateTime<Local> {
    match Local.timestamp_millis_opt(ms as i64) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(dt, _) => dt,
        LocalResult::None => Local::now(),
    }
}

fn local_midnight(date: NaiveDate) -> DateTime<Local> {
    let naive = date
        .and_hms_opt(0, 0, 0)
        .unwrap_or_else(|| NaiveDateTime::new(date, chrono::NaiveTime::MIN));
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(dt, _) => dt,
        LocalResult::None => local_datetime_from_ms(Utc::now().timestamp_millis().max(0) as u64),
    }
}

fn range_from_local_dates(start: NaiveDate, end: NaiveDate) -> TemporalRange {
    TemporalRange {
        start_ms: local_midnight(start).timestamp_millis().max(0) as u64,
        end_ms: local_midnight(end).timestamp_millis().max(0) as u64,
    }
}

fn rolling_range(now: DateTime<Local>, duration: Duration) -> TemporalRange {
    let start = now - duration;
    TemporalRange {
        start_ms: start.timestamp_millis().max(0) as u64,
        end_ms: now.timestamp_millis().max(0) as u64,
    }
}

fn normalized_query(query: &str) -> String {
    query
        .chars()
        .map(|ch| if ch.is_ascii_punctuation() { ' ' } else { ch })
        .collect::<String>()
        .to_ascii_lowercase()
}

fn number_range_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"\b(?P<num>\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?P<unit>day|days|week|weeks|month|months|year|years)\s+ago(?:\s+(?P<anchor>today|tonight))?\b",
        )
        .expect("valid ago regex")
    })
}

fn past_range_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"\b(?:past|last|previous|within the last|in the last)\s+(?P<num>\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?P<unit>day|days|week|weeks|month|months|year|years)\b",
        )
        .expect("valid past-range regex")
    })
}

fn weekday_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"\b(?P<qualifier>last|this)\s+(?P<weekday>monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
        )
        .expect("valid weekday regex")
    })
}

fn weekday_ago_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"\b(?P<num>\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?P<weekday>monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\s+ago\b",
        )
        .expect("valid weekday ago regex")
    })
}

fn parse_count(raw: &str) -> Option<i64> {
    match raw {
        "one" => Some(1),
        "two" => Some(2),
        "three" => Some(3),
        "four" => Some(4),
        "five" => Some(5),
        "six" => Some(6),
        "seven" => Some(7),
        "eight" => Some(8),
        "nine" => Some(9),
        "ten" => Some(10),
        "eleven" => Some(11),
        "twelve" => Some(12),
        _ => raw.parse::<i64>().ok(),
    }
}

fn weekday_number(name: &str) -> Option<u32> {
    match name {
        "monday" => Some(0),
        "tuesday" => Some(1),
        "wednesday" => Some(2),
        "thursday" => Some(3),
        "friday" => Some(4),
        "saturday" => Some(5),
        "sunday" => Some(6),
        _ => None,
    }
}

fn resolve_relative_weekday(
    today: NaiveDate,
    current_weekday_num: u32,
    qualifier: &str,
    weekday_name: &str,
) -> Option<NaiveDate> {
    let target = weekday_number(weekday_name)? as i64;
    let current = current_weekday_num as i64;
    match qualifier {
        "this" => {
            let delta = target - current;
            Some(today + Duration::days(delta))
        }
        "last" => {
            let backward = (current - target).rem_euclid(7);
            let days = if backward == 0 { 7 } else { backward };
            Some(today - Duration::days(days))
        }
        _ => None,
    }
}

fn nth_prior_weekday(
    today: NaiveDate,
    current_weekday_num: u32,
    weekday_name: &str,
    count: i64,
) -> Option<NaiveDate> {
    let target = weekday_number(weekday_name)? as i64;
    let current = current_weekday_num as i64;
    let backward = (current - target).rem_euclid(7);
    let first = if backward == 0 { 7 } else { backward };
    Some(today - Duration::days(first + ((count - 1).max(0) * 7)))
}

pub fn companion_time_awareness_enabled(session: &Session) -> bool {
    session
        .companion_state
        .as_ref()
        .and_then(|value| value.get("preferences"))
        .and_then(|value| {
            value
                .get("timeAwarenessEnabled")
                .or_else(|| value.get("time_awareness_enabled"))
        })
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

pub fn time_placeholder_values(reference_ms: u64) -> Vec<(&'static str, String)> {
    let now = local_datetime_from_ms(reference_ms);
    let date_full = format!(
        "{}, {} {}, {}",
        now.format("%A"),
        now.format("%B"),
        now.day(),
        now.year()
    );
    vec![
        ("{{date}}", now.format("%Y-%m-%d").to_string()),
        ("{{date_full}}", date_full),
        ("{{weekday}}", now.format("%A").to_string()),
        ("{{time_hour}}", now.format("%H").to_string()),
        ("{{time_minute}}", now.format("%M").to_string()),
        ("{{time_second}}", now.format("%S").to_string()),
        ("{{time_full}}", now.format("%H:%M:%S %:z").to_string()),
        ("{{time_12hour_format}}", now.format("%I:%M %p").to_string()),
        ("{{time_timezone}}", now.format("%:z").to_string()),
        ("{{time_timezone_name}}", now.format("%Z").to_string()),
        ("{{datetime_iso}}", now.to_rfc3339()),
    ]
}

pub fn format_memory_for_prompt(memory: &MemoryEmbedding) -> String {
    let mut line = format!("- {}", memory.text);
    if let Some(observed_at) = memory.observed_at {
        let observed = local_datetime_from_ms(observed_at);
        line.push_str(&format!(
            " (observed {})",
            observed.format("%Y-%m-%d %H:%M %Z")
        ));
    }
    line
}

pub fn memory_matches_temporal_range(memory: &MemoryEmbedding, range: &TemporalRange) -> bool {
    let Some(observed_at) = memory.observed_at else {
        return false;
    };
    observed_at >= range.start_ms && observed_at < range.end_ms
}

pub fn detect_temporal_query_range(query: &str, reference_ms: u64) -> Option<TemporalRange> {
    let normalized = normalized_query(query);
    let now = local_datetime_from_ms(reference_ms);
    let today = now.date_naive();
    let tomorrow = today + Duration::days(1);

    if normalized.contains("yesterday") {
        let start = today - Duration::days(1);
        return Some(range_from_local_dates(start, today));
    }
    if normalized.contains("today") || normalized.contains("tonight") {
        return Some(range_from_local_dates(today, tomorrow));
    }
    if normalized.contains("last week") {
        let start_of_week = today - Duration::days(today.weekday().num_days_from_monday() as i64);
        return Some(range_from_local_dates(
            start_of_week - Duration::days(7),
            start_of_week,
        ));
    }
    if normalized.contains("this week") || normalized.contains("earlier this week") {
        let start_of_week = today - Duration::days(today.weekday().num_days_from_monday() as i64);
        return Some(range_from_local_dates(
            start_of_week,
            start_of_week + Duration::days(7),
        ));
    }
    if normalized.contains("last month") {
        let start_of_this_month = today.with_day(1)?;
        let end_of_last_month = start_of_this_month - Duration::days(1);
        let start_of_last_month = end_of_last_month.with_day(1)?;
        return Some(range_from_local_dates(
            start_of_last_month,
            start_of_this_month,
        ));
    }
    if normalized.contains("this month") || normalized.contains("earlier this month") {
        let start_of_this_month = today.with_day(1)?;
        let start_of_next_month = if start_of_this_month.month() == 12 {
            NaiveDate::from_ymd_opt(start_of_this_month.year() + 1, 1, 1)?
        } else {
            NaiveDate::from_ymd_opt(
                start_of_this_month.year(),
                start_of_this_month.month() + 1,
                1,
            )?
        };
        return Some(range_from_local_dates(
            start_of_this_month,
            start_of_next_month,
        ));
    }
    if normalized.contains("last year") {
        return Some(range_from_local_dates(
            NaiveDate::from_ymd_opt(today.year() - 1, 1, 1)?,
            NaiveDate::from_ymd_opt(today.year(), 1, 1)?,
        ));
    }
    if normalized.contains("this year") || normalized.contains("earlier this year") {
        return Some(range_from_local_dates(
            NaiveDate::from_ymd_opt(today.year(), 1, 1)?,
            NaiveDate::from_ymd_opt(today.year() + 1, 1, 1)?,
        ));
    }

    if let Some(captures) = weekday_regex().captures(&normalized) {
        let qualifier = captures.name("qualifier")?.as_str();
        let weekday = captures.name("weekday")?.as_str();
        let target_date = resolve_relative_weekday(
            today,
            today.weekday().num_days_from_monday(),
            qualifier,
            weekday,
        )?;
        return Some(range_from_local_dates(
            target_date,
            target_date + Duration::days(1),
        ));
    }

    if let Some(captures) = weekday_ago_regex().captures(&normalized) {
        let amount = parse_count(captures.name("num")?.as_str())?;
        let weekday = captures.name("weekday")?.as_str();
        let target_date = nth_prior_weekday(
            today,
            today.weekday().num_days_from_monday(),
            weekday,
            amount,
        )?;
        return Some(range_from_local_dates(
            target_date,
            target_date + Duration::days(1),
        ));
    }

    if let Some(captures) = number_range_regex().captures(&normalized) {
        let amount = parse_count(captures.name("num")?.as_str())?;
        let unit = captures.name("unit")?.as_str();
        let anchor = captures.name("anchor").map(|value| value.as_str());
        return match unit {
            "day" | "days" if anchor.is_some() => {
                let start = today - Duration::days(amount);
                Some(range_from_local_dates(start, start + Duration::days(1)))
            }
            "day" | "days" => Some(rolling_range(now, Duration::days(amount))),
            "week" | "weeks" if anchor.is_some() => {
                let start = today - Duration::days(7 * amount);
                Some(range_from_local_dates(start, start + Duration::days(1)))
            }
            "week" | "weeks" => {
                let start_of_this_week =
                    today - Duration::days(today.weekday().num_days_from_monday() as i64);
                let start = start_of_this_week - Duration::days(7 * amount);
                Some(range_from_local_dates(start, start + Duration::days(7)))
            }
            "month" | "months" if anchor.is_some() => {
                let mut year = today.year();
                let mut month = today.month() as i32 - amount as i32;
                while month <= 0 {
                    month += 12;
                    year -= 1;
                }
                let day = today.day().min(days_in_month(year, month as u32));
                let start = NaiveDate::from_ymd_opt(year, month as u32, day)?;
                Some(range_from_local_dates(start, start + Duration::days(1)))
            }
            "month" | "months" => {
                let mut year = today.year();
                let mut month = today.month() as i32 - amount as i32;
                while month <= 0 {
                    month += 12;
                    year -= 1;
                }
                let start = NaiveDate::from_ymd_opt(year, month as u32, 1)?;
                let end = if month == 12 {
                    NaiveDate::from_ymd_opt(year + 1, 1, 1)?
                } else {
                    NaiveDate::from_ymd_opt(year, month as u32 + 1, 1)?
                };
                Some(range_from_local_dates(start, end))
            }
            "year" | "years" if anchor.is_some() => {
                let target_year = today.year() - amount as i32;
                let day = today.day().min(days_in_month(target_year, today.month()));
                let start = NaiveDate::from_ymd_opt(target_year, today.month(), day)?;
                Some(range_from_local_dates(start, start + Duration::days(1)))
            }
            "year" | "years" => Some(range_from_local_dates(
                NaiveDate::from_ymd_opt(today.year() - amount as i32, 1, 1)?,
                NaiveDate::from_ymd_opt(today.year() - amount as i32 + 1, 1, 1)?,
            )),
            _ => None,
        };
    }

    if let Some(captures) = past_range_regex().captures(&normalized) {
        let amount = parse_count(captures.name("num")?.as_str())?;
        let unit = captures.name("unit")?.as_str();
        return match unit {
            "day" | "days" => Some(rolling_range(now, Duration::days(amount))),
            "week" | "weeks" => Some(rolling_range(now, Duration::days(7 * amount))),
            "month" | "months" => Some(rolling_range(now, Duration::days(30 * amount))),
            "year" | "years" => Some(rolling_range(now, Duration::days(365 * amount))),
            _ => None,
        };
    }

    None
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let next = NaiveDate::from_ymd_opt(next_year, next_month, 1).expect("valid next month");
    (next - Duration::days(1)).day()
}

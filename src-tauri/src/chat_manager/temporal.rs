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

fn zh_ago_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?P<num>\d+|[一二两三四五六七八九十]+)\s*个?\s*(?P<unit>天|日|周|星期|礼拜|月|年)\s*前")
            .expect("valid zh ago regex")
    })
}

fn zh_recent_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?:最近|近|过去|过去的|这)\s*(?P<num>\d+|[一二两三四五六七八九十]+)\s*个?\s*(?P<unit>天|日|周|星期|礼拜|月|年)")
            .expect("valid zh recent regex")
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

fn parse_zh_count(raw: &str) -> Option<i64> {
    if let Ok(value) = raw.parse::<i64>() {
        return Some(value);
    }
    match raw {
        "一" => Some(1),
        "二" | "两" => Some(2),
        "三" => Some(3),
        "四" => Some(4),
        "五" => Some(5),
        "六" => Some(6),
        "七" => Some(7),
        "八" => Some(8),
        "九" => Some(9),
        "十" => Some(10),
        value if value.starts_with('十') => parse_zh_count(&value[3..]).map(|v| 10 + v),
        value if value.ends_with('十') => {
            parse_zh_count(&value[..value.len() - 3]).map(|v| v * 10)
        }
        value if value.contains('十') => {
            let mut parts = value.splitn(2, '十');
            let tens = parts.next().and_then(parse_zh_count).unwrap_or(1);
            let ones = parts
                .next()
                .filter(|s| !s.is_empty())
                .and_then(parse_zh_count)
                .unwrap_or(0);
            Some(tens * 10 + ones)
        }
        _ => None,
    }
}

fn month_range(today: NaiveDate, months_ago: i32) -> Option<TemporalRange> {
    let mut year = today.year();
    let mut month = today.month() as i32 - months_ago;
    while month <= 0 {
        month += 12;
        year -= 1;
    }
    while month > 12 {
        month -= 12;
        year += 1;
    }
    let start = NaiveDate::from_ymd_opt(year, month as u32, 1)?;
    let end = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)?
    } else {
        NaiveDate::from_ymd_opt(year, month as u32 + 1, 1)?
    };
    Some(range_from_local_dates(start, end))
}

fn year_range(today: NaiveDate, years_ago: i32) -> Option<TemporalRange> {
    let year = today.year() - years_ago;
    Some(range_from_local_dates(
        NaiveDate::from_ymd_opt(year, 1, 1)?,
        NaiveDate::from_ymd_opt(year + 1, 1, 1)?,
    ))
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

struct TimeOverride {
    mode: String,
    anchor_ms: Option<u64>,
    set_at_ms: Option<u64>,
}

fn read_time_override(session: &Session) -> Option<TimeOverride> {
    let value = session
        .companion_state
        .as_ref()
        .and_then(|value| value.get("preferences"))
        .and_then(|value| value.get("timeOverride"))?;
    Some(TimeOverride {
        mode: value
            .get("mode")
            .and_then(|mode| mode.as_str())
            .unwrap_or("off")
            .to_string(),
        anchor_ms: value.get("anchorMs").and_then(|anchor| anchor.as_u64()),
        set_at_ms: value.get("setAtMs").and_then(|set_at| set_at.as_u64()),
    })
}

pub fn companion_effective_now(session: &Session) -> u64 {
    let real_now = crate::utils::now_millis().unwrap_or_default();
    let Some(override_value) = read_time_override(session) else {
        return real_now;
    };
    match override_value.mode.as_str() {
        "frozen" => override_value.anchor_ms.unwrap_or(real_now),
        "ticking" => match (override_value.anchor_ms, override_value.set_at_ms) {
            (Some(anchor), Some(set_at)) => anchor.saturating_add(real_now.saturating_sub(set_at)),
            _ => real_now,
        },
        _ => real_now,
    }
}

/// Offset `delta` such that a message's effective-frame timestamp is
/// `created_at + delta`, keeping the transcript consistent with
/// `companion_effective_now`. `latest_window_created_ms` is the newest message
/// timestamp in the batch being sent (used to anchor the frozen frame).
pub fn temporal_frame_delta(session: &Session, latest_window_created_ms: u64) -> i64 {
    let Some(override_value) = read_time_override(session) else {
        return 0;
    };
    match override_value.mode.as_str() {
        "frozen" => match override_value.anchor_ms {
            Some(anchor) => anchor as i64 - latest_window_created_ms as i64,
            None => 0,
        },
        "ticking" => match (override_value.anchor_ms, override_value.set_at_ms) {
            (Some(anchor), Some(set_at)) => anchor as i64 - set_at as i64,
            _ => 0,
        },
        _ => 0,
    }
}

pub fn format_message_timestamp(effective_ms: u64) -> String {
    let dt = local_datetime_from_ms(effective_ms);
    format!("[{}]", dt.format("%a %-I:%M %p, %Y-%m-%d"))
}

pub fn message_timestamp_prefix(created_at: u64, frame_delta: i64) -> String {
    let effective = (created_at as i64 + frame_delta).max(0) as u64;
    format_message_timestamp(effective)
}

fn echoed_timestamp_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        // Matches ONLY the app's own injected stamp, `[Tue 6:50 PM, 2026-03-12]`
        // (see `format_message_timestamp`), anywhere in the text. The strict
        // signature — 12-hour clock + AM/PM + ISO date inside brackets — keeps
        // roleplay brackets like `[she smiles]` and other time formats intact.
        // The weekday is optional in case a model drops or expands it.
        Regex::new(
            r"(?i)\[\s*(?:[a-z]{3,9}\s+)?\d{1,2}:\d{2}\s*(?:am|pm)\s*,?\s*\d{4}-\d{2}-\d{2}\s*\]\s*",
        )
        .expect("valid echoed timestamp regex")
    })
}

/// Removes any `[Tue 6:50 PM, 2026-03-12]`-style stamp a model may echo back so
/// it is never persisted or re-stamped. Strips matches wherever they appear, not
/// just at the start. Conservative: only matches the app's own time format,
/// leaving roleplay brackets like `[she smiles]` and unrelated timestamps alone.
pub fn strip_echoed_time_stamps(text: &str) -> String {
    echoed_timestamp_regex()
        .replace_all(text, "")
        .trim()
        .to_string()
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

pub fn humanize_relative(delta_ms: i64, _precision: Option<&str>) -> String {
    let future = delta_ms < 0;
    let seconds = delta_ms.unsigned_abs() / 1000;
    const MINUTE: u64 = 60;
    const HOUR: u64 = 60 * MINUTE;
    const DAY: u64 = 24 * HOUR;
    const WEEK: u64 = 7 * DAY;
    const MONTH: u64 = 30 * DAY;
    const YEAR: u64 = 365 * DAY;

    if seconds < 45 {
        return "just now".to_string();
    }

    let (count, unit) = if seconds < HOUR {
        (seconds / MINUTE, "minute")
    } else if seconds < DAY {
        (seconds / HOUR, "hour")
    } else if seconds < WEEK {
        (seconds / DAY, "day")
    } else if seconds < MONTH {
        (seconds / WEEK, "week")
    } else if seconds < YEAR {
        (seconds / MONTH, "month")
    } else {
        (seconds / YEAR, "year")
    };
    let count = count.max(1);

    if unit == "day" && count == 1 {
        return if future {
            "tomorrow".to_string()
        } else {
            "yesterday".to_string()
        };
    }

    let plural = if count == 1 { "" } else { "s" };
    if future {
        format!("in {} {}{}", count, unit, plural)
    } else {
        format!("{} {}{} ago", count, unit, plural)
    }
}

pub fn format_memory_for_prompt(memory: &MemoryEmbedding, effective_now: u64) -> String {
    let mut line = format!("- {}", memory.text);
    if let Some(observed_at) = memory.observed_at {
        let observed = local_datetime_from_ms(observed_at);
        let relative = humanize_relative(
            effective_now as i64 - observed_at as i64,
            memory.observed_time_precision.as_deref(),
        );
        line.push_str(&format!(
            " (observed {}, {})",
            observed.format("%Y-%m-%d %H:%M %Z"),
            relative
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

    if normalized.contains("大前天") {
        let start = today - Duration::days(3);
        return Some(range_from_local_dates(start, start + Duration::days(1)));
    }
    if normalized.contains("前天") {
        let start = today - Duration::days(2);
        return Some(range_from_local_dates(start, start + Duration::days(1)));
    }
    if normalized.contains("昨天") || normalized.contains("昨日") {
        let start = today - Duration::days(1);
        return Some(range_from_local_dates(start, today));
    }
    if normalized.contains("今天") || normalized.contains("今日") || normalized.contains("今晚")
    {
        return Some(range_from_local_dates(today, tomorrow));
    }
    if normalized.contains("上上周")
        || normalized.contains("上上星期")
        || normalized.contains("上上礼拜")
    {
        let start_of_week = today - Duration::days(today.weekday().num_days_from_monday() as i64);
        return Some(range_from_local_dates(
            start_of_week - Duration::days(14),
            start_of_week - Duration::days(7),
        ));
    }
    if normalized.contains("上周") || normalized.contains("上星期") || normalized.contains("上礼拜")
    {
        let start_of_week = today - Duration::days(today.weekday().num_days_from_monday() as i64);
        return Some(range_from_local_dates(
            start_of_week - Duration::days(7),
            start_of_week,
        ));
    }
    if normalized.contains("这周")
        || normalized.contains("本周")
        || normalized.contains("这个星期")
        || normalized.contains("这星期")
        || normalized.contains("这个礼拜")
        || normalized.contains("这礼拜")
    {
        let start_of_week = today - Duration::days(today.weekday().num_days_from_monday() as i64);
        return Some(range_from_local_dates(
            start_of_week,
            start_of_week + Duration::days(7),
        ));
    }
    if normalized.contains("上上个月") || normalized.contains("上上月") {
        return month_range(today, 2);
    }
    if normalized.contains("上个月") || normalized.contains("上月") {
        return month_range(today, 1);
    }
    if normalized.contains("这个月") || normalized.contains("本月") || normalized.contains("这月")
    {
        return month_range(today, 0);
    }
    if normalized.contains("前年") {
        return year_range(today, 2);
    }
    if normalized.contains("去年") {
        return year_range(today, 1);
    }
    if normalized.contains("今年") {
        return year_range(today, 0);
    }

    if let Some(captures) = zh_ago_regex().captures(&normalized) {
        let amount = parse_zh_count(captures.name("num")?.as_str())?;
        let unit = captures.name("unit")?.as_str();
        return match unit {
            "天" | "日" => {
                let start = today - Duration::days(amount);
                Some(range_from_local_dates(start, start + Duration::days(1)))
            }
            "周" | "星期" | "礼拜" => {
                let start_of_this_week =
                    today - Duration::days(today.weekday().num_days_from_monday() as i64);
                let start = start_of_this_week - Duration::days(7 * amount);
                Some(range_from_local_dates(start, start + Duration::days(7)))
            }
            "月" => month_range(today, amount as i32),
            "年" => year_range(today, amount as i32),
            _ => None,
        };
    }

    if let Some(captures) = zh_recent_regex().captures(&normalized) {
        let amount = parse_zh_count(captures.name("num")?.as_str())?;
        let unit = captures.name("unit")?.as_str();
        return match unit {
            "天" | "日" => Some(rolling_range(now, Duration::days(amount))),
            "周" | "星期" | "礼拜" => Some(rolling_range(now, Duration::days(7 * amount))),
            "月" => Some(rolling_range(now, Duration::days(30 * amount))),
            "年" => Some(rolling_range(now, Duration::days(365 * amount))),
            _ => None,
        };
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    fn ms_utc(year: i32, month: u32, day: u32) -> u64 {
        Utc.with_ymd_and_hms(year, month, day, 12, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis() as u64
    }

    fn local_date(ms: u64) -> NaiveDate {
        local_datetime_from_ms(ms).date_naive()
    }

    #[test]
    fn detects_zh_yesterday() {
        let range = detect_temporal_query_range("昨天我们聊了什么", ms_utc(2026, 7, 9)).unwrap();
        assert_eq!(
            local_date(range.start_ms),
            NaiveDate::from_ymd_opt(2026, 7, 8).unwrap()
        );
        assert_eq!(
            local_date(range.end_ms),
            NaiveDate::from_ymd_opt(2026, 7, 9).unwrap()
        );
    }

    #[test]
    fn detects_zh_month_before_last() {
        let range = detect_temporal_query_range("上上个月发生了什么", ms_utc(2026, 7, 9)).unwrap();
        assert_eq!(
            local_date(range.start_ms),
            NaiveDate::from_ymd_opt(2026, 5, 1).unwrap()
        );
        assert_eq!(
            local_date(range.end_ms),
            NaiveDate::from_ymd_opt(2026, 6, 1).unwrap()
        );
    }

    #[test]
    fn detects_zh_numeric_ago() {
        let range = detect_temporal_query_range("三天前说过什么", ms_utc(2026, 7, 9)).unwrap();
        assert_eq!(
            local_date(range.start_ms),
            NaiveDate::from_ymd_opt(2026, 7, 6).unwrap()
        );
        assert_eq!(
            local_date(range.end_ms),
            NaiveDate::from_ymd_opt(2026, 7, 7).unwrap()
        );
    }
}

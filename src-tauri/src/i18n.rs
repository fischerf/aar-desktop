//! UI language for texts produced on the Rust side (tray menu, error
//! messages returned to the webview). The webview resolves the language
//! ("auto" = Windows display language) and reports it via `set_ui_language`.
//!
//! ```ignore
//! tr("Beenden", "Quit", "退出")
//! trf!("{n} Dateien", "{n} files", "{n} 个文件")   // format!-style, captures work
//! ```

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    De,
    En,
    Zh,
}

static LANG: AtomicU8 = AtomicU8::new(0);

pub fn lang() -> Lang {
    match LANG.load(Ordering::Relaxed) {
        1 => Lang::En,
        2 => Lang::Zh,
        _ => Lang::De,
    }
}

/// Accepts "de" / "en" / "zh" (anything else = German, the project default).
pub fn set_lang(code: &str) -> Lang {
    let l = parse(code).unwrap_or(Lang::De);
    LANG.store(
        match l {
            Lang::De => 0,
            Lang::En => 1,
            Lang::Zh => 2,
        },
        Ordering::Relaxed,
    );
    l
}

pub fn parse(code: &str) -> Option<Lang> {
    let c = code.trim().to_ascii_lowercase();
    if c.starts_with("de") {
        Some(Lang::De)
    } else if c.starts_with("en") {
        Some(Lang::En)
    } else if c.starts_with("zh") {
        Some(Lang::Zh)
    } else {
        None
    }
}

pub fn tr<'a>(de: &'a str, en: &'a str, zh: &'a str) -> &'a str {
    match lang() {
        Lang::De => de,
        Lang::En => en,
        Lang::Zh => zh,
    }
}

/// `format!` in the current UI language.
#[macro_export]
macro_rules! trf {
    ($de:literal, $en:literal, $zh:literal $(, $($arg:tt)*)?) => {
        match $crate::i18n::lang() {
            $crate::i18n::Lang::De => format!($de $(, $($arg)*)?),
            $crate::i18n::Lang::En => format!($en $(, $($arg)*)?),
            $crate::i18n::Lang::Zh => format!($zh $(, $($arg)*)?),
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    // Only pure checks: the language is process-wide and tests run in parallel.
    #[test]
    fn parses_language_tags() {
        assert_eq!(parse("en-US"), Some(Lang::En));
        assert_eq!(parse("zh-Hans-CN"), Some(Lang::Zh));
        assert_eq!(parse(" DE "), Some(Lang::De));
        assert_eq!(parse("auto"), None);
    }
}

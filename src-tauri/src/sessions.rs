//! Saved conversations of aar (`<sessions dir>\<id>.jsonl`, one event per
//! line) for the conversation list in the widget.

use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionEntry {
    pub id: String,
    /// First message of the user (whitespace collapsed, shortened); "" when
    /// it only had an image.
    pub title: String,
    pub modified_ms: u64,
}

/// Session ids are file names: no paths, no dots.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Conversations in `dir`, newest first. Sessions without a user message
/// (opened but never used) are left out.
pub fn list(dir: &Path, limit: usize) -> Vec<SessionEntry> {
    let Ok(entries) = std::fs::read_dir(dir) else { return vec![] };
    let mut files: Vec<(u64, PathBuf, String)> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension()? != "jsonl" {
                return None;
            }
            let id = path.file_stem()?.to_str()?.to_string();
            if !valid_id(&id) {
                return None;
            }
            let modified = e.metadata().ok()?.modified().ok()?;
            let ms = modified.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
            Some((ms, path, id))
        })
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.2.cmp(&b.2)));
    let mut out = vec![];
    for (modified_ms, path, id) in files {
        if out.len() >= limit {
            break;
        }
        if let Some(title) = first_user_message(&path) {
            out.push(SessionEntry { id, title, modified_ms });
        }
    }
    out
}

/// Delete a saved conversation.
pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err(format!("invalid session id: {id}"));
    }
    let path = dir.join(format!("{id}.jsonl"));
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn first_user_message(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    for line in BufReader::new(file).lines().take(10_000) {
        let Ok(line) = line else { return None };
        if !line.contains("\"user_message\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if v.get("type").and_then(Value::as_str) != Some("user_message") {
            continue;
        }
        let text = v.get("content").map(content_text).unwrap_or_default();
        return Some(shorten(&text.split_whitespace().collect::<Vec<_>>().join(" "), 120));
    }
    None
}

/// `content` is a string or a list of parts (`{"type": "text", "text": …}`).
fn content_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.as_str().or_else(|| p.get("text").and_then(Value::as_str)))
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}

fn shorten(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max - 1).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aar-ui-sessions-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const META: &str = r#"{"_meta": true, "schema_version": 1, "session_id": "x", "state": "idle"}"#;

    #[test]
    fn lists_conversations_with_their_first_question() {
        let dir = temp_dir("list");
        std::fs::write(
            dir.join("aaa111.jsonl"),
            format!(
                "{META}\n{}\n{}\n",
                r#"{"id":"1","type":"user_message","timestamp":1,"content":"Wie  steht\ndie Aktie?","parts":[]}"#,
                r#"{"id":"2","type":"user_message","timestamp":2,"content":"Und morgen?","parts":[]}"#
            ),
        )
        .unwrap();
        // Opened but never used: no entry.
        std::fs::write(dir.join("bbb222.jsonl"), format!("{META}\n")).unwrap();
        std::fs::write(
            dir.join("ccc333.jsonl"),
            format!("{META}\n{}\n", r#"{"type":"user_message","content":[{"type":"text","text":"Mal ein Bild"}]}"#),
        )
        .unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();
        let list = list(&dir, 10);
        let mut titles: Vec<(&str, &str)> = list.iter().map(|e| (e.id.as_str(), e.title.as_str())).collect();
        titles.sort();
        assert_eq!(titles, vec![("aaa111", "Wie steht die Aktie?"), ("ccc333", "Mal ein Bild")]);
        assert!(list.iter().all(|e| e.modified_ms > 0));
        assert_eq!(super::list(&dir, 1).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deletes_only_plain_ids() {
        let dir = temp_dir("delete");
        std::fs::write(dir.join("abc.jsonl"), META).unwrap();
        assert!(delete(&dir, "../abc").is_err());
        assert!(delete(&dir, "abc.jsonl").is_err());
        assert!(dir.join("abc.jsonl").exists());
        delete(&dir, "abc").unwrap();
        assert!(!dir.join("abc.jsonl").exists());
        delete(&dir, "abc").unwrap(); // already gone
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn long_titles_are_shortened() {
        let s = "x".repeat(200);
        assert_eq!(shorten(&s, 120).chars().count(), 120);
        assert!(shorten(&s, 120).ends_with('…'));
    }
}

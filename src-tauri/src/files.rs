//! Files the agent produced in a turn, offered as "Öffnen / Im Ordner zeigen".

use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Types the widget may open with their default program: documents, data and
/// images. Never executables, scripts, shortcuts or installers.
const DOCUMENTS: &[&str] = &[
    "pdf", "md", "markdown", "txt", "html", "htm", "rtf", "odt", "doc", "docx", "xls", "xlsx",
    "ods", "ppt", "pptx", "csv", "json", "xml", "png", "jpg", "jpeg", "gif", "webp", "svg",
    "heic", "heif", "bmp", "tif", "tiff",
];

pub fn is_document(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| DOCUMENTS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Existing files among `paths` modified at or after `since`, newest first,
/// without duplicates (case-insensitive, like Windows paths).
pub fn recent(paths: Vec<PathBuf>, since: SystemTime) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut found: Vec<(SystemTime, PathBuf)> = paths
        .into_iter()
        .filter_map(|p| {
            let meta = std::fs::metadata(&p).ok()?;
            let modified = meta.modified().ok()?;
            (meta.is_file() && modified >= since).then_some((modified, p))
        })
        .filter(|(_, p)| seen.insert(p.to_string_lossy().to_lowercase()))
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, p)| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn only_documents_can_be_opened() {
        for ok in ["a.pdf", "b.MD", "c.docx", "d.png", "e.html"] {
            assert!(is_document(Path::new(ok)), "{ok}");
        }
        for bad in ["a.exe", "b.bat", "c.ps1", "d.lnk", "e.js", "f.vbs", "g.msi", "noext"] {
            assert!(!is_document(Path::new(bad)), "{bad}");
        }
    }

    #[test]
    fn recent_keeps_new_existing_files_once() {
        let dir = std::env::temp_dir().join(format!("aar-ui-files-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let old = dir.join("old.md");
        let new = dir.join("new.pdf");
        std::fs::write(&old, "x").unwrap();
        let since = SystemTime::now() + Duration::from_millis(1500);
        std::thread::sleep(Duration::from_millis(1600));
        std::fs::write(&new, "x").unwrap();
        let got = recent(
            vec![old.clone(), new.clone(), new.clone(), dir.join("missing.txt"), dir.clone()],
            since,
        );
        assert_eq!(got, vec![new]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

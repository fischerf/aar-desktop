fn main() {
    // Microsoft's CRT libs reference PDBs from their build machines; lld-link
    // warns for each (LNK4099, missing debug info only). Silence it.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg=/ignore:4099");
    }
    tauri_build::build()
}

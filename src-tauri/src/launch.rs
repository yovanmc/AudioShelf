//! CLI launch args used by the self-verification harness. Ported from MangaReader;
//! `parse_lenient` ignores unknown args the WebView/Tauri may inject.

use clap::Parser;
use serde::Serialize;

#[derive(Parser, Debug, Clone, Serialize, Default)]
#[command(name = "AudioShelf")]
#[serde(rename_all = "camelCase")]
pub struct LaunchArgs {
    #[arg(long)]
    pub library: Option<String>,
    #[arg(long, default_value_t = false)]
    pub autostart: bool,
    #[arg(long)]
    pub walkthrough: Option<String>,
    #[arg(long)]
    pub shots: Option<String>,
    #[arg(long)]
    pub done_signal: Option<String>,
    #[arg(long, default_value_t = false)]
    pub exit_when_done: bool,
}

impl LaunchArgs {
    pub fn parse_lenient<I: IntoIterator<Item = String>>(args: I) -> Self {
        LaunchArgs::try_parse_from(args).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::LaunchArgs;

    #[test]
    fn parses_known_flags() {
        let args = LaunchArgs::parse_lenient(
            ["audioshelf", "--library", "C:/lib", "--autostart", "--walkthrough", "browse"]
                .map(String::from),
        );
        assert_eq!(args.library.as_deref(), Some("C:/lib"));
        assert!(args.autostart);
        assert_eq!(args.walkthrough.as_deref(), Some("browse"));
    }

    #[test]
    fn ignores_unknown_args() {
        let args = LaunchArgs::parse_lenient(["audioshelf", "--webview-flag=xyz"].map(String::from));
        assert!(args.library.is_none());
    }
}

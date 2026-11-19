//! The OCR variations: how robust the reading of a real screenshot is (`ocr-check --variations`). The variations are made
//! in memory from the maintainer's five screenshots, read with the production reading and counted; none is written to disk.
pub mod catalogue;
pub mod outcome;
pub mod report;
pub mod run;
pub mod transforms;

//! AGS-03: the committed contract types equal a fresh generation from the JSON Schemas.

use std::fs;

use xtask::{
    CONTRACTS, generate, generate_schema_module, generated_path, schema_dir, schema_file_names,
    schema_module_path,
};

#[test]
fn contracts_are_current() {
    let generated = generate(&schema_dir()).expect("the schemas generate");
    let committed = fs::read_to_string(generated_path())
        .expect("adapters/src/contracts/generated.rs is committed")
        .replace("\r\n", "\n");
    assert!(
        generated == committed,
        "generated.rs is stale: run `cargo run -p xtask -- contracts` and commit the result"
    );
}

#[test]
fn schema_copy_is_current() {
    let generated = generate_schema_module(&schema_dir()).expect("the schemas generate");
    let committed = fs::read_to_string(schema_module_path())
        .expect("adapters/src/contracts/schemas.rs is committed")
        .replace("\r\n", "\n");
    assert!(
        generated == committed,
        "schemas.rs is stale: run `cargo run -p xtask -- contracts` and commit the result"
    );
}

#[test]
fn contract_list_matches_the_schema_files() {
    let mut listed: Vec<String> = CONTRACTS.iter().map(|(file, _)| file.to_string()).collect();
    listed.sort();
    let on_disk = schema_file_names(&schema_dir()).expect("the schema directory lists");
    assert_eq!(listed, on_disk);
}

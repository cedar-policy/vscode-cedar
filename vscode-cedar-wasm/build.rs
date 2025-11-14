use std::fs;
use toml::Value;

fn main() {
    println!("cargo:rerun-if-changed=Cargo.lock");
    
    // Read the Cargo.lock file
    let contents = fs::read_to_string("Cargo.lock")
        .expect("Should be able to read Cargo.lock");
    
    // Parse the TOML content
    let value: Value = contents.parse()
        .expect("Should be able to parse Cargo.lock as TOML");
    
    // Find the cedar-policy package in the [[package]] array
    let packages = value.get("package")
        .expect("Should have package array")
        .as_array()
        .expect("package should be an array");
    
    let cedar_pkg = packages.iter()
        .find(|p| p.get("name")
            .and_then(|n| n.as_str()) 
            .map_or(false, |n| n == "cedar-policy"))
        .expect("cedar-policy package not found");
    
    let version = cedar_pkg.get("version")
        .expect("package should have version")
        .as_str()
        .expect("version should be a string");

    println!("cargo:rustc-env=CEDAR_VERSION={version}");
}

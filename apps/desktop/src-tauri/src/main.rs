// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// Prevents a console window from appearing behind the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    thesmos_desktop_lib::run()
}

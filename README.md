# C systems sandboxes

Browser pages for eight C and ARM32 systems programs, compiled to WebAssembly. No server. Demos 01–03 are public; 04–08 are private demos, published only in encrypted form and shared on request.

**https://r800360.github.io/c-systems-sandboxes/**

| # | Sandbox | Shows |
|---|---|---|
| 01 | [Stack corruption forensics](https://r800360.github.io/c-systems-sandboxes/stack-corruption-debugging/) | off-by-one stack write and NULL store across x86-64, arm64, ARM32, WebAssembly |
| 02 | [Minimal comment-stripping DFA](https://r800360.github.io/c-systems-sandboxes/comment-stripping-dfa/) | table-driven transducer, minimization |
| 03 | [C comment stripper](https://r800360.github.io/c-systems-sandboxes/c-comment-stripper/) | hand-written state handlers, line tracking |
| 04 | 🔒 [Zero-copy CSV column selector](https://r800360.github.io/c-systems-sandboxes/csv-column-selector/) | in-place tokenizing, pointer tables |
| 05 | 🔒 [Hash-table ticket database](https://r800360.github.io/c-systems-sandboxes/parking-ticket-db/) | chained hashing, live memory layout |
| 06 | 🔒 [Insert, delete and ownership](https://r800360.github.io/c-systems-sandboxes/parking-ticket-db-writes/) | pointer-to-pointer unlinking, malloc/free tracking |
| 07 | 🔒 [ARM32 bit cipher](https://r800360.github.io/c-systems-sandboxes/arm32-book-cipher/) | bit reversal + XOR, ARM32 leaf routines |
| 08 | 🔒 [ARM32 stack frames](https://r800360.github.io/c-systems-sandboxes/arm32-cipher-frames/) | AAPCS frames captured from QEMU + GDB |

Each folder is published by its project's CI after the build passes native, sanitizer, Valgrind, QEMU and WebAssembly tests. Public folders hold compiled output only (their adapted code is Apache-2.0 licensed). Private folders hold a preview page and an AES-256-GCM encrypted bundle; the passphrase decrypts it in the visitor's browser, and the bundle includes the demo's complete source, as the GNU GPL v3 requires for those programs.

// Run: node candidate-helper.mjs --request <request.json> --input <draft.json> [--check]
// Draft: {summary,steps,afterCommit?}; IDs and version come from the request.
// Precheck is not host commit. Keep native cwd; use absolute paths.
import "./candidate-helper-core.mjs";

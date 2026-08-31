# Contributing

1. Open an issue for classifier or schema changes that alter notification semantics.
2. Add a fixture/test for every new positive phrase and every false-positive exclusion.
3. Preserve hard reset, banked reset, personal window and community observation as distinct states.
4. Do not add a numeric forecast unless the dataset contains timestamped predictions on event and non-event days and reports calibration.
5. Run `npm run check` before opening a pull request.

Historical changes must preserve the original post ID/URL and explain why the previous record was wrong. Never replace a first-party source with an aggregator summary.

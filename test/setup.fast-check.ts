// Shared fast-check configuration for all property-based tests.
//
// Every property test defaults to a minimum of 100 iterations, per the design's
// testing strategy ("Each property test runs a minimum of 100 iterations").
// Individual tests may still raise numRuns locally, but never fall below this
// floor unless they override it explicitly.
import fc from "fast-check";

fc.configureGlobal({ numRuns: 100 });

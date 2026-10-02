// A null agent whose build fails: the step reports an error and exits non-zero, so no dist/ exists.
// Calibration must type it `build-failed` and never probe or grade the page.
process.stderr.write("calibration fixture: this build fails on purpose\n");
process.exit(1);

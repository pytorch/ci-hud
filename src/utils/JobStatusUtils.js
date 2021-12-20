export function is_success(result) {
    return result === "SUCCESS" || result === "success";
}

export function is_failure(result) {
    // TODO: maybe classify timeout differently
    return (
        result === "FAILURE" ||
        result === "failure" ||
        result === "error" ||
        result === "timed_out"
    );
}

export function is_aborted(result) {
    return result === "ABORTED" || result === "cancelled";
}

export function is_pending(result) {
    return !result || result === "pending";
}

export function is_skipped(result) {
    return result === "skipped";
}

export function is_infra_failure(result) {
    return result === "infrastructure_fail";
}
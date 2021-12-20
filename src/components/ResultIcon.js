// @flow

import React from 'react'
import {
    is_success,
    is_skipped,
    is_failure,
    is_aborted,
    is_pending,
    is_infra_failure
} from '../utils/JobStatusUtils.js';
import { FcCancel } from "react-icons/fc";

export default function ResultIcon({ result }) {

    if (is_success(result))
        return (
            <span role="img" style={{ color: "green" }} aria-label="passed">
                0
            </span>
        );
    if (is_skipped(result))
        return (
            <span role="img" style={{ color: "gray" }} aria-label="skipped">
                S
            </span>
        );
    if (is_failure(result))
        return (
            <span role="img" style={{ color: "red" }} aria-label="failed">
                X
            </span>
        );
    if (is_aborted(result))
        return (
            <span
                role="img"
                style={{ marginLeft: "-2px", color: "gray" }}
                aria-label="cancelled"
            >
                <FcCancel />
            </span>
        );
    if (is_pending(result))
        return (
            <span
                className="animate-flicker"
                role="img"
                style={{ color: "goldenrod" }}
                aria-label="in progress"
            >
                ?
            </span>
        );
    if (is_infra_failure(result))
        return (
            <span role="img" style={{ color: "grey" }} aria-label="failed">
                X
            </span>
        );
    return null;
}


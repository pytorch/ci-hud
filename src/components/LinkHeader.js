import React from "react";
import BranchLink from "./BranchLink";
import { getStatusUrl, getLinkUrl } from "../utils/GetStatusUrlUtils";

const BRANCHES = ["master", "viable/strict", "nightly", "release/1.10"];

export default function LinkHeader() {
  return BRANCHES.map((branch) => {
    return (
      <li key={`${branch}`}>
        <BranchLink
          jsonUrl={getStatusUrl("pytorch", "pytorch", branch)}
          link={getLinkUrl("pytorch", "pytorch", branch)}
        >
          {branch + " "}
        </BranchLink>
      </li>
    );
  });
}

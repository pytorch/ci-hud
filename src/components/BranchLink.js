import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { is_failure, is_pending } from "../utils/JobStatusUtils";
import ResultIcon from "./ResultIcon";
export default function BranchLink({ jsonUrl, link, children }) {

  const [commits, setCommits] = useState({});
  useEffect(() => {
    axios.get(jsonUrl).then((response) => {
      setCommits(response.data);
    });
  }, [jsonUrl]);

  let status = "success";
  for (const job of commits[0]?.jobs ?? []) {
    if (is_failure(job.status)) {
      status = "failure";
      break;
    }
    if (is_pending(job.status)) {
      status = "pending;";
    }
  }

  return (
    <Link to={link}>
      {children}
      <ResultIcon result={status} />
    </Link>
  );
}

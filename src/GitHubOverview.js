// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Component } from "react";
import { s3 } from "./utils.js";
import Card from "react-bootstrap/Card";
import { BsFillQuestionCircleFill } from "react-icons/all";
import Tooltip from "rc-tooltip";

const COLORS = {
  green: "#58c157",
  yellow: "#e2b325",
  red: "#ff0504",
  grey: "#a3a3a3",
  blank: "rgba(0, 0, 0, 0)",
};

class BranchDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = {
      repos: [],
    };
    this.canvas = React.createRef();
  }

  componentDidMount() {
    this.update();
  }

  componentDidUpdate() {
    const ref = this.canvas.current;
    /** @type {CanvasRenderingContext2D} */
    const ctx = ref.getContext("2d");
    ctx.beginPath();
    const colors = {
      success: COLORS.green,
      failure: COLORS.red,
      error: COLORS.red,
      neutral: COLORS.grey,
      cancelled: COLORS.red,
      pending: COLORS.yellow,
      queued: COLORS.yellow,
      unknown: COLORS.blank,
    };
    for (const [x, statuses] of this.state.statuses.entries()) {
      for (const [y, status] of statuses.entries()) {
        const fill = colors[status];
        if (!fill) {
          console.error("Unknown", status);
        }
        ctx.fillStyle = fill;
        ctx.fillRect(y, x, 1, 1);
      }
    }
  }

  async update() {
    const url = `https://s3.amazonaws.com/ossci-job-status/v5/${this.props.user}/${this.props.repo}/${this.props.json}`;
    const resp = await fetch(url);
    const data = await resp.json();
    let jobNames = {};
    let byName = [];
    for (const commit of data) {
      let jobsByName = {};
      for (const job of commit.jobs) {
        jobNames[job.name] = true;
        jobsByName[job.name] = job;
      }
      byName.push(jobsByName);
    }
    jobNames = Object.keys(jobNames);
    jobNames.sort();
    let statuses = [];
    for (const commit of byName) {
      let commitStatuses = [];
      for (const jobName of jobNames) {
        let status = "unknown";
        if (commit[jobName]) {
          status = commit[jobName].status;
        }
        commitStatuses.push(status);
      }
      statuses.push(commitStatuses);
    }
    this.setState({ statuses: statuses });
  }

  render() {
    let canvas = null;
    if (this.state.statuses && this.state.statuses.length > 0) {
      canvas = (
        <canvas
          height="100"
          width={this.state.statuses[0].length}
          ref={this.canvas}
        ></canvas>
      );
    }
    return (
      <div
        style={{
          border: "1px solid #d2d2d2",
          borderRadius: "5px",
          padding: "10px",
          margin: "5px",
          display: "grid",
          gridTemplateRows: "3em auto",
          textAlign: "center",
        }}
      >
        <span>
          <a href={`https://github.com/${this.props.user}/${this.props.repo}`}>
            {this.props.user}/{this.props.repo}
          </a>
          <a
            style={{ marginLeft: "5px" }}
            href={`/ci/${this.props.user}/${this.props.repo}/${this.props.branch}`}
          >
            {this.props.branch}
          </a>
        </span>
        <div>
          <a
            href={`/ci/${this.props.user}/${this.props.repo}/${this.props.branch}`}
          >
            {canvas}
          </a>
        </div>
      </div>
    );
  }
}

export default class GitHubOverview extends Component {
  constructor(props) {
    super(props);
    this.state = {
      repos: [],
    };
  }

  componentDidMount() {
    this.update();
  }

  async s3ListBucket(prefix) {
    let result = await s3(prefix, "ossci-job-status");
    let items = [];
    if (result.ListBucketResult.CommonPrefixes) {
      let folders = result.ListBucketResult.CommonPrefixes;
      if (Array.isArray(folders)) {
        items = items.concat(folders.map((item) => item.Prefix.textContent));
      } else {
        items.push(folders.Prefix.textContent);
      }
    }
    if (result.ListBucketResult.Contents) {
      let files = result.ListBucketResult.Contents;
      if (Array.isArray(files)) {
        items = items.concat(files.map((item) => item.Key.textContent));
      } else {
        // Only 1 item in the folder
        items.push(files.Key.textContent);
      }
    }
    return items;
  }

  async update() {
    // List users with a folder
    const users = await this.s3ListBucket("v5/");
    const promises = users.map((user) => {
      return (async () => {
        const prefixes = await this.s3ListBucket(user);
        // List repos in a folder
        return await Promise.all(
          prefixes.map((repo) => this.s3ListBucket(repo))
        );
      })();
    });
    let repos = await Promise.all(promises);
    this.setState({ repos: repos.flat() });
  }

  render() {
    let cards = [];
    let branches = [];
    for (const repo of this.state.repos) {
      const match = repo[0].match(/v5\/(.*)\/(.*)\//);
      const user = match[1];
      const repoName = match[2];
      for (const branch of repo) {
        const branchMatch = branch.match(/v5\/.*\/.*\/(.*)/);
        const branchName = branchMatch[1]
          .replace("_", "/")
          .replace(".json", "");
        branches.push(
          <BranchDisplay
            key={`branch-${repoName}-${branchName}`}
            user={user}
            repo={repoName}
            branch={branchName}
            json={branchMatch[1]}
          />
        );
      }
    }
    return (
      <div>
        <h4>PyTorch Org CI Overview</h4>
        <p>
          Status roll up for PyTorch and domain libraries{" "}
          <Tooltip
            key="help"
            overlay="Each CI job for each branch in each repo corresponds to 1 pixel in the visualizations below"
            mouseLeaveDelay={0}
            placement="rightTop"
            destroyTooltipOnHide={{ keepParent: false }}
          >
            <span style={{ color: "#a1a1a1", cursor: "pointer" }}>
              <BsFillQuestionCircleFill />
            </span>
          </Tooltip>
        </p>
        <div style={{ display: "flex", flexWrap: "wrap" }}>{branches}</div>
      </div>
    );
  }
}

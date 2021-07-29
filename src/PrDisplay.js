// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Component } from "react";
import Card from "react-bootstrap/Card";
import AuthorizeGitHub from "./AuthorizeGitHub.js";
import TestReportRenderer from "./pr/TestReportRenderer.js";
import {
  BsFillCaretRightFill,
  BsCaretDownFill,
  BsFillCaretDownFill,
  GoPrimitiveDot,
  GoCircleSlash,
  GoCheck,
  GoX,
} from "react-icons/all";
import { LazyLog } from "react-lazylog";

import { parseXml, formatBytes, asyncAll, s3, github } from "./utils.js";

const PREVIEW_BASE_URL = "https://docs-preview.pytorch.org";

function getPrQuery(number) {
  return `
    {
      repository(name: "pytorch", owner: "pytorch") {
        pullRequest(number: ${number}) {
          title
          number
          url
          commits(last: 1) {
            nodes {
              commit {
                checkSuites(last: 100) {
                  nodes {
                    databaseId
                    workflowRun {
                      runNumber
                      id
                      databaseId
                      workflow {
                        name
                        databaseId
                      }
                      url
                    }
                    checkRuns(last: 100) {
                      nodes {
                        name
                        title
                        status
                        conclusion
                        text
                        databaseId
                        detailsUrl
                        summary
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
}

function getCommitQuery(hash) {
  return `
    {
      repository(name: "pytorch", owner: "pytorch") {
        object(oid:"${hash}") {
          ... on Commit {
            history(first: 1) {
              nodes {
                oid
                commitUrl
                messageHeadline
                messageBody
                checkSuites(last: 100) {
                  nodes {
                    databaseId
                    workflowRun {
                      runNumber
                      id
                      databaseId
                      workflow {
                        name
                        databaseId
                      }
                      url
                    }
                    checkRuns(last: 100) {
                      nodes {
                        name
                        title
                        status
                        conclusion
                        text
                        databaseId
                        detailsUrl
                        summary
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
}

export default class PrDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = {
      pr_number: this.props.pr_number,
      commit_hash: this.props.commit_hash,
      showGroups: [],
    };
  }

  componentDidMount() {
    this.update();
  }

  isPr() {
    return this.state.pr_number !== undefined;
  }

  extractItem(result, key) {
    // Some of the stuff from s3 can come in as a single object or an array,
    // so unpack that here
    if (!result[key]) {
      return null;
    }

    if (Array.isArray(result[key])) {
      return result[key];
    }
    return [result[key]];
  }

  async componentDidUpdate(prevProps, prevState) {
    for (const run of this.state.runs) {
      for (const check of run.checkRuns.nodes) {
        if (!check.log.shown || check.log.text !== null) {
          continue;
        }

        github
          .raw(`repos/pytorch/pytorch/actions/jobs/${check.databaseId}/logs`)
          .then((log) => log.text())
          .then((log) => {
            check.log.text = log;
            this.setState(this.state);
          });
      }
    }
  }

  async update() {
    // Set some global persistent state to redirect back to this window for log
    // ins
    localStorage.setItem("last_redirect", window.location.href);

    // Fetch the PR's info from GitHub's GraphQL API
    if (!localStorage.getItem("gh_pat")) {
      return;
    }

    if (this.isPr()) {
      let pr_result = await github.graphql(getPrQuery(this.state.pr_number));
      this.state.pr = pr_result.repository.pullRequest;
      this.state.commit = this.state.pr.commits.nodes[0].commit;
    } else {
      let commit = await github.graphql(getCommitQuery(this.state.commit_hash));
      this.state.commit = commit.repository.object.history.nodes[0];
    }

    // The GraphQL API doesn't have any types for artifacts (at least as far as
    // I can tell), so we have to fall back to iterating through them all via
    // the v3 JSON API
    let workflow_runs = this.state.commit.checkSuites.nodes;
    workflow_runs = workflow_runs.filter((x) => x.workflowRun);
    workflow_runs.forEach((run) => {
      run.checkRuns.nodes.forEach((check) => {
        check.log = {
          text: null,
          shown: false,
        };
      });
    });
    await asyncAll(
      workflow_runs.map((run) => {
        return async () => {
          let id = run.workflowRun.databaseId;
          run.artifacts = await github.json(
            `repos/pytorch/pytorch/actions/runs/${id}/artifacts`
          );
        };
      })
    );

    workflow_runs = workflow_runs.sort((a, b) =>
      a.workflowRun.workflow.name.toUpperCase() >
      b.workflowRun.workflow.name.toUpperCase()
        ? 1
        : -1
    );
    this.state.runs = workflow_runs;
    this.setState(this.state);

    // Go through all the runs and check if there is a prefix for the workflow
    // run in S3 (indicating that there are some relevant artifacts stored
    // there)
    let promises = this.state.runs.map((run) => {
      run.s3_artifacts = [];
      return async () => {
        // Check that the workflow run exists
        let result = await s3(`pytorch/pytorch/${run.workflowRun.databaseId}/`);

        let prefixes = this.extractItem(
          result.ListBucketResult,
          "CommonPrefixes"
        );

        // If anything was found, go through the results and add the items to
        // the 'run' object in place
        if (prefixes && prefixes.length > 0) {
          for (const prefixItem of prefixes) {
            let prefix = prefixItem.Prefix["#text"];
            let result = await s3(prefix);
            let contents = this.extractItem(
              result.ListBucketResult,
              "Contents"
            );
            for (const content of contents) {
              run.s3_artifacts.push(content);
            }
          }
        }
      };
    });
    await asyncAll(promises);
    this.setState(this.state);
  }

  render() {
    let runs = undefined;
    let groups = {
      "Add annotations": [],
      "Close stale pull requests": [],
      "Label PRs & Issues": [],
      Triage: [],
      "Update S3 HTML indices for download.pytorch.org": [],
    };

    if (this.state.runs) {
      runs = [];

      // Render all of the check runs as a list
      for (const [run_index, run] of this.state.runs.entries()) {
        const checks = [];
        for (const [index, check] of run.checkRuns.nodes.entries()) {
          const toggle = () => {
            check.log.shown = !check.log.shown;
            this.setState(this.state);
          };
          const iconStyle = { cursor: "pointer" };
          let icon = (
            <BsFillCaretRightFill style={iconStyle} onClick={toggle} />
          );

          let log = <div></div>;
          if (check.log.shown) {
            icon = <BsFillCaretDownFill style={iconStyle} onClick={toggle} />;
            if (check.log.text) {
              const totalLines = (check.log.text.match(/\n/g) || "").length + 1;

              log = (
                <div style={{ height: `${Math.min(totalLines + 4, 30)}em` }}>
                  <LazyLog
                    extraLines={1}
                    enableSearch
                    caseInsensitive
                    selectableLines
                    scrollToLine={totalLines}
                    text={check.log.text}
                  />
                </div>
              );
            } else {
              log = <p>fetching logs...</p>;
            }
          }
          const statuses = {
            SUCCESS: <GoCheck style={{ color: "#22863a" }} />,
            FAILURE: <GoX style={{ color: "#cb2431" }} />,
            NEUTRAL: <GoCircleSlash style={{ color: "#959da5" }} />,
          };
          let statusIcon = statuses[check.conclusion] || (
            <GoPrimitiveDot style={{ color: "#dbab09" }} />
          );

          checks.push(
            <div key={"check-run-" + index}>
              {statusIcon} <a href={check.detailsUrl}>{check.name}</a> {icon}{" "}
              {log}
            </div>
          );
        }

        let artifacts = [];
        function makeArtifact(args) {
          if (args.expired) {
            return (
              <div key={`${args.kind}-${args.index}`}>
                <span>
                  [{args.kind}] {args.name}
                </span>{" "}
                <span>({formatBytes(args.size_in_bytes)}) (expired)</span>
              </div>
            );
          } else {
            return (
              <div key={`${args.kind}-${args.index}`}>
                <a href={args.url}>
                  [{args.kind}] {args.name}
                </a>{" "}
                <span>({formatBytes(args.size_in_bytes)})</span>
                {args.extra}
              </div>
            );
          }
        }

        // List out artifacts hosted on GitHub
        let showReports = <div></div>;
        if (run.artifacts) {
          if (run.artifacts.artifacts !== undefined) {
            let reportUrl = null;
            for (const [index, artifact] of run.artifacts.artifacts.entries()) {
              // The URL in the response is for the API, not browsers, so make it
              // manually
              let url = `https://github.com/pytorch/pytorch/suites/${run.databaseId}/artifacts/${artifact.id}`;
              artifacts.push(
                makeArtifact({
                  kind: "gha",
                  index: index,
                  name: artifact.name,
                  size_in_bytes: artifact.size_in_bytes,
                  url: url,
                  expired: artifact.expired,
                })
              );
            }
          } else {
            artifacts.push(
              <div key={`artifact-${run.databaseId}`}>
                <span>Can't query artifacts (hit GitHub rate limit)</span>
              </div>
            );
          }
        }

        // List out artifacts from s3
        if (run.s3_artifacts) {
          for (const [index, artifact] of run.s3_artifacts.entries()) {
            let prefix = artifact.Key["#text"];
            let name = prefix.split("/").slice(-1)[0];
            let url = `https://gha-artifacts.s3.amazonaws.com/${prefix}`;

            let extra = null;
            if (name.startsWith("test-reports-") && name.endsWith(".zip")) {
              extra = (
                <button
                  style={{ marginLeft: "5px", fontSize: "0.7em" }}
                  className="btn btn-info"
                  onClick={async () => {
                    // showReport might be undefined the first time so explicitly
                    // spell it out here to avoid any falsiness
                    if (artifact.showReport) {
                      artifact.showReport = false;
                    } else {
                      artifact.showReport = true;
                    }
                    this.setState(this.state);
                    this.render();
                  }}
                >
                  {artifact.showReport ? "Hide Results" : "Render Results"}
                </button>
              );
            }

            artifacts.push(
              makeArtifact({
                kind: "s3",
                index: index,
                name: prefix.split("/").slice(-1),
                size_in_bytes: parseInt(artifact.Size["#text"]),
                url: url,
                expired: false,
                extra: extra,
              })
            );

            if (artifact.showReport) {
              let key = `s3-${index}-reports`;
              artifacts.push(
                <TestReportRenderer testReportZip={url} key={key} />
              );
            }
          }
        }

        // If there were any artifacts, set up the 'div' to show them
        let artifactsElement = <div></div>;
        if (artifacts.length > 0) {
          artifactsElement = (
            <div style={{ padding: "6px" }}>
              <h5>Artifacts</h5>
              {artifacts}
            </div>
          );
        }

        let checksElement = <div></div>;
        if (checks.length > 0) {
          checksElement = <div style={{ padding: "6px" }}>{checks}</div>;
        }

        // Wrap up everything in a card
        const title = run.workflowRun.workflow.name;
        const card = (
          <Card key={"card-" + run_index}>
            <Card.Body>
              <Card.Title>
                <a href={run.workflowRun.url}>{title}</a>
              </Card.Title>
              <div>
                {checksElement}
                {artifactsElement}
                {showReports}
              </div>
            </Card.Body>
          </Card>
        );

        function groupCard(icon) {
          groups[title].push(card);
          if (groups[title].length === 1) {
            const groupCard = (
              <Card key={"group-card-" + run_index}>
                <Card.Body>
                  <Card.Title>
                    {title} {icon}
                  </Card.Title>
                </Card.Body>
              </Card>
            );
            runs.push(groupCard);
          }
        }

        // Some jobs are uninteresting and there are a bunch of them, so group
        // them all together here
        if (title in groups) {
          if (this.state.showGroups.includes(title)) {
            // Group would normally be hidden, but this one has been toggled on
            // so show it
            const toggleGroup = () => {
              this.state.showGroups.pop(this.state.showGroups.indexOf(title));
              this.setState(this.state);
            };
            let icon = (
              <BsFillCaretDownFill
                style={{ cursor: "pointer" }}
                onClick={toggleGroup}
              />
            );
            groupCard(icon, toggleGroup);
            runs.push(card);
          } else {
            // Hide group
            const toggleGroup = () => {
              this.state.showGroups.push(title);
              this.setState(this.state);
            };
            let icon = (
              <BsFillCaretRightFill
                style={{ cursor: "pointer" }}
                onClick={toggleGroup}
              />
            );
            groupCard(icon, toggleGroup);
          }
        } else {
          runs.push(card);
        }
      }
    }

    // Search through all the checks for a docs build, if it's completed then
    // assume it's also been uploaded to S3 (which should happen as part of the
    // docs build on PRs)
    let docPreview = <span></span>;
    if (this.state.runs) {
      for (const [run_index, run] of this.state.runs.entries()) {
        for (const [index, check] of run.checkRuns.nodes.entries()) {
          if (
            check.name === "pytorch_python_doc_build" &&
            check.status === "COMPLETED" &&
            check.conclusion === "SUCCESS"
          ) {
            docPreview = (
              <div style={{ paddingBottom: "5px" }}>
                <a
                  href={`${PREVIEW_BASE_URL}/${this.state.pr_number}/`}
                  target="_blank"
                  className="btn btn-primary"
                >
                  Documentation Preview
                </a>
              </div>
            );
          }
        }
      }
    }

    let title = null;
    if (this.state.commit) {
      if (this.isPr()) {
        title = (
          <h2>
            <a
              href={
                "https://github.com/pytorch/pytorch/pull/" +
                this.state.pr_number
              }
            >
              PR #{this.state.pr_number}
            </a>
          </h2>
        );
      } else {
        let subject = this.state.commit.messageHeadline;
        let headline = <p>{subject}</p>;
        let match = subject.match(/\(#([\d]+)\)$/);
        if (match && match[1]) {
          let pr_number = match[1];
          subject = subject.replace(match[0], "");
          headline = (
            <p>
              {subject}{" "}
              <a href={`https://github.com/pytorch/pytorch/pull/${pr_number}`}>
                (#{pr_number})
              </a>
            </p>
          );
        }

        title = (
          <div>
            <h2>
              Commit{" "}
              <a href={this.state.commit.commitUrl}>
                {this.state.commit.oid.slice(0, 7)}
              </a>
            </h2>
            {headline}
          </div>
        );
      }
    }

    let loading = null;
    if (!this.state.commit) {
      loading = <p>Loading... (make sure you are signed in)</p>;
    }

    return (
      <div>
        <AuthorizeGitHub />

        {title}
        {loading}

        {docPreview}
        <div>{runs}</div>
      </div>
    );
  }
}

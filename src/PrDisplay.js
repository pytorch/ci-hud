// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Component } from "react";
import Card from "react-bootstrap/Card";
import "bootstrap/dist/css/bootstrap.min.css";
import AuthorizeGitHub from "./AuthorizeGitHub.js";

import { parseXml, formatBytes, asyncAll, s3, github } from "./utils.js";

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
                      }
                      url
                    }
                    checkRuns(last: 100) {
                      nodes {
                        name
                        title
                        text
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
    };
  }
  componentDidMount() {
    this.update();
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

  async update() {
    // Set some global persistent state to redirect back to this window for log
    // ins
    localStorage.setItem("last_redirect", window.location.href);

    // Fetch the PR's info from GitHub's GraphQL API
    localStorage.getItem("gh_pat");
    if (!localStorage.getItem("gh_pat")) {
      return;
    }
    let pr_result = await github.graphql(getPrQuery(this.state.pr_number));
    this.state.pr = pr_result.repository.pullRequest;

    // The GraphQL API doesn't have any types for artifacts (at least as far as
    // I can tell), so we have to fall back to iterating through them all via
    // the v3 JSON API
    let workflow_runs = this.state.pr.commits.nodes[0].commit.checkSuites.nodes;
    workflow_runs = workflow_runs.filter((x) => x.workflowRun);
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
    if (this.state.runs) {
      runs = [];

      // Render all of the check runs as a list
      for (const [run_index, run] of this.state.runs.entries()) {
        const checks = [];
        for (const [index, check] of run.checkRuns.nodes.entries()) {
          checks.push(
            <div key={"check-run-" + index}>
              - <a href={check.detailsUrl}>{check.name}</a>
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
              </div>
            );
          }
        }

        // List out artifacts hosted on GitHub
        if (run.artifacts) {
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
        }

        // List out artifacts from s3
        if (run.s3_artifacts) {
          for (const [index, artifact] of run.s3_artifacts.entries()) {
            let prefix = artifact.Key["#text"];

            artifacts.push(
              makeArtifact({
                kind: "s3",
                index: index,
                name: prefix.split("/").slice(-1),
                size_in_bytes: parseInt(artifact.Size["#text"]),
                url: `https://gha-artifacts.s3.amazonaws.com/${prefix}`,
                expired: false,
              })
            );
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
          checksElement = (
            <div style={{ padding: "6px" }}>
              <h5>Checks</h5>
              {checks}
            </div>
          );
        }

        // Wrap up everything in a card
        const card = (
          <Card key={"card-" + run_index}>
            <Card.Body>
              <Card.Title>
                <a href={run.workflowRun.url}>
                  {run.workflowRun.workflow.name}
                </a>
              </Card.Title>
              <div>
                {checksElement}
                {artifactsElement}
              </div>
            </Card.Body>
          </Card>
        );
        runs.push(card);
      }
    }

    return (
      <div>
        <AuthorizeGitHub />

        <h2>
          <a
            href={
              "https://github.com/pytorch/pytorch/pull/" + this.state.pr_number
            }
          >
            PR #{this.state.pr_number}
          </a>
        </h2>
        <p>
          {this.state.pr
            ? this.state.pr.title
            : "loading (make sure you are signed in)..."}
        </p>
        <div>{runs}</div>
      </div>
    );
  }
}

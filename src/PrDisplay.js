// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Component } from "react";
import Card from "react-bootstrap/Card";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import ToggleButton from "react-bootstrap/ToggleButton";
import FailureReport from "./pr/FailureReport.js";
import TestReportRenderer from "./pr/TestReportRenderer.js";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import { filterLog, registerLogLanguage } from "./pr/logs.js";
import CircleCICard from "./pr/CircleCICard.js";
import Spin from "./Spin.js";
import { BsFillCaretRightFill, BsFillCaretDownFill } from "react-icons/bs";

import { GoPrimitiveDot, GoCircleSlash, GoCheck, GoX } from "react-icons/go";

import { formatBytes, asyncAll, s3, github } from "./utils.js";

const PREVIEW_BASE_URL = "https://docs-preview.pytorch.org";

// Returns true if the location is local or a deploy preview
function isOnDevelopmentHost() {
  return (
    window.location.href.startsWith("http://localhost") ||
    window.location.href.startsWith("https://deploy-preview")
  );
}

function getCommitsForPrQuery(user, repo, number) {
  return `
    {
      repository(name: "${repo}", owner: "${user}") {
        pullRequest(number: ${number}) {
          commits(last: 100) {
            nodes {
              commit {
                oid
              }
            }
          }
        }
      }
    }
  `;
}

function getPrQuery(user, repo, number) {
  return `
    {
      repository(name: "${repo}", owner: "${user}") {
        pullRequest(number: ${number}) {
          title
          number
          url
          body
          comments(last: 10) {
            nodes {
              author {
                login
              }
              body
            }
          }
          commits(last: 1) {
            nodes {
              commit {
                messageHeadline
                oid
                status {
                  contexts {
                    description
                    context
                    targetUrl
                    state
                  }
                }
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

function getCommitQuery(user, repo, hash) {
  return `
    {
      repository(name: "${repo}", owner: "${user}") {
        object(oid:"${hash}") {
          ... on Commit {
            history(first: 1) {
              nodes {
                oid
                commitUrl
                messageHeadline
                messageBody
                status {
                  contexts {
                    description
                    context
                    targetUrl
                    state
                  }
                }
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
      showGroups: [],
    };
  }

  componentDidMount() {
    this.update({}).catch((error) => {
      console.error(error);
      this.setState({ error_message: error.toString() });
    });
  }

  isPr() {
    return this.props.pr_number !== undefined;
  }
  hasError() {
    return this.state.error_message !== undefined;
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
    if (this.hasError()) {
      return;
    }
    for (const run of this.state.runs) {
      for (const check of run.checkRuns.nodes) {
        if (!check.log.shown || check.log.text !== null) {
          continue;
        }

        github
          .raw(
            `repos/${this.props.user}/${this.props.repo}/actions/jobs/${check.databaseId}/logs`
          )
          .then((log) => log.text())
          .then((log) => {
            check.log.text = log;
            this.setState(this.state);
          });
      }
    }
  }

  async update(params) {
    // Set some global persistent state to redirect back to this window for log
    // ins
    localStorage.setItem("last_redirect", window.location.href);

    if (isOnDevelopmentHost()) {
      // If we're in development, prompt the user for a token to manually enter
      if (!localStorage.getItem("gh_pat")) {
        const token = prompt(
          'In development mode, GitHub API token not found. You can get it from hud.pytorch.org by running localStorage.getItem("gh_pat") in the JavaScript console.'
        );
        if (token) {
          localStorage.setItem("gh_pat", token);
        }
      }
    }

    if (this.hasError()) {
      return;
    }

    if (!localStorage.getItem("gh_pat")) {
      this.setState({ error_message: "GitHub token no found, please log in" });
      return;
    }
    let pr = undefined;
    let commit = undefined;
    if (this.isPr()) {
      // Fetch the PR's info from GitHub's GraphQL API
      let commitResponse = null;
      if (params && params.selectedCommit) {
        const selectedCommit = params.selectedCommit;
        commitResponse = await github.graphql(
          getCommitQuery(this.props.user, this.props.repo, selectedCommit)
        );
      }
      let [prResult, prCommits] = await Promise.all([
        github.graphql(
          getPrQuery(this.props.user, this.props.repo, this.props.pr_number)
        ),
        github.graphql(
          getCommitsForPrQuery(
            this.props.user,
            this.props.repo,
            this.props.pr_number
          )
        ),
      ]);
      pr = prResult.repository.pullRequest;
      pr.allCommits = prCommits.repository.pullRequest.commits.nodes
        .map((n) => n.commit.oid)
        .reverse();
      if (pr === null || pr === undefined) {
        this.state.error_message = "Failed to fetch PR " + this.props.pr_number;
        this.setState(this.state);
        return;
      }
      if (commitResponse) {
        pr.commits.nodes = [
          { commit: commitResponse.repository.object.history.nodes[0] },
        ];
      }
      commit = pr.commits.nodes[0].commit;
    } else {
      let commitResponse = await github.graphql(
        getCommitQuery(this.props.user, this.props.repo, this.props.commit_hash)
      );
      if (commitResponse.repository.object == null) {
        this.setState({
          error_message: `Failed to fetch ${this.props.commit_hash}`,
        });
        return;
      }
      commit = commitResponse.repository.object.history.nodes[0];
    }

    // The GraphQL API doesn't have any types for artifacts (at least as far as
    // I can tell), so we have to fall back to iterating through them all via
    // the v3 JSON API
    let workflow_runs = commit.checkSuites.nodes;
    workflow_runs = workflow_runs.filter((x) => x.workflowRun);
    workflow_runs.forEach((run) => {
      run.checkRuns.nodes.forEach((check) => {
        check.log = {
          text: null,
          shown: false,
          logLevel: "Minimal",
        };
      });
    });
    await asyncAll(
      workflow_runs.map((run) => {
        return async () => {
          let id = run.workflowRun.databaseId;
          run.artifacts = await github.json(
            `repos/${this.props.user}/${this.props.repo}/actions/runs/${id}/artifacts`
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
    for (const run of workflow_runs) {
      run.status = this.mergeStatuses(
        run.checkRuns.nodes.map((check) => check.conclusion)
      );
    }
    let statuses = [];
    if (commit.status) {
      statuses = commit.status.contexts;
    }
    this.setState({
      pr: pr,
      commit: commit,
      runs: workflow_runs,
      statuses: statuses,
      loadingNewCommit: false,
    });

    // Go through all the runs and check if there is a prefix for the workflow
    // run in S3 (indicating that there are some relevant artifacts stored
    // there)
    let promises = this.state.runs.map((run) => {
      run.s3_artifacts = [];
      if (this.props.repo !== "pytorch") {
        // Ignore for non-pytorch/pytorch repos
        return async () => {
          // Intentional no-op
          return;
        };
      }
      return async () => {
        // Check that the workflow run exists
        let result = await s3(
          `pytorch/pytorch/${run.workflowRun.databaseId}/`,
          "gha-artifacts"
        );

        let prefixes = this.extractItem(
          result.ListBucketResult,
          "CommonPrefixes"
        );

        // If anything was found, go through the results and add the items to
        // the 'run' object in place
        if (prefixes && prefixes.length > 0) {
          for (const prefixItem of prefixes) {
            let prefix = prefixItem.Prefix["#text"];
            let result = await s3(prefix, "gha-artifacts");
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

  renderDocPreviewButton() {
    // Search through all the checks for a docs build, if it's completed then
    // assume it's also been uploaded to S3 (which should happen as part of the
    // docs build on PRs)
    let python = null;
    let cpp = null;

    const runIsPassing = (name) => {
      for (const run of this.state.runs) {
        for (const check of run.checkRuns.nodes) {
          if (
            check.name === name &&
            check.status === "COMPLETED" &&
            check.conclusion === "SUCCESS"
          ) {
            return true;
          }
        }
      }
      return false;
    };

    if (this.state.runs) {
      if (runIsPassing("build-docs (python)")) {
        python = (
          <a
            href={`${PREVIEW_BASE_URL}/${this.props.pr_number}/index.html`}
            target="_blank"
            className="btn btn-primary"
            style={{ marginRight: "5px" }}
            rel="noreferrer"
          >
            Python Docs
          </a>
        );
      }
      if (runIsPassing("build-docs (cpp)")) {
        cpp = (
          <a
            href={`${PREVIEW_BASE_URL}/${this.props.pr_number}/cppdocs/index.html`}
            target="_blank"
            className="btn btn-primary"
            rel="noreferrer"
          >
            C++ Docs
          </a>
        );
      }
    }
    return (
      <div style={{ paddingBottom: "5px" }}>
        {python}

        {cpp}
      </div>
    );
  }

  renderTitle() {
    let title = null;
    if (this.state.commit) {
      if (this.isPr()) {
        title = (
          <div>
            <h3>
              <a
                href={`https://github.com/${this.props.user}/${this.props.repo}/pull/${this.props.pr_number}`}
              >
                {this.state.pr.title} (#{this.props.pr_number})
              </a>
            </h3>
          </div>
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
              <a
                href={`https://github.com/${this.props.user}/${this.props.repo}/pull/${pr_number}`}
              >
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
    return title;
  }

  findDiffInComments(comments) {
    let diff = null;
    for (const comment of comments) {
      // We don't care about user supplied updates from ghstack since those are
      // in the PR body
      if (comment.author.login === "facebook-github-bot") {
        let match = comment.body.match(
          /https:\/\/www\.internalfb\.com\/diff\/(D\d+)/
        );
        if (match) {
          diff = match[1];
        }
      }
    }
    return diff;
  }

  renderDiff() {
    if (!this.state.commit) {
      return null;
    }

    // Try to find the diff in the commit message or PR body
    let text = this.state.commit.messageBody;
    let diff = null;
    if (this.isPr()) {
      text = this.state.pr.body;
    }
    const match = text.match(/Differential Revision: (\[)?(D\d+)(\])?/);
    if (match) {
      diff = match[2];
    }

    if (!diff && this.isPr()) {
      // If we didn't find a diff, search the PR comment for facebook-github-bot
      // comments
      diff = this.findDiffInComments(this.state.pr.comments.nodes);
    }

    return <a href={`https://www.internalfb.com/diff/${diff}`}>{diff}</a>;
  }

  renderBody() {
    if (!this.state.commit) {
      return null;
    }

    let text = this.state.commit.messageBody;
    if (this.isPr()) {
      text = this.state.pr.body;
    }

    return (
      <div style={{ maxHeight: "13em", overflow: "scroll", margin: "10px" }}>
        <ReactMarkdown children={text} />
      </div>
    );
  }

  getGroupRanges(monaco, text) {
    const lines = text.split("\n");
    const starts = [];
    const ends = [];
    let lineNumber = 0;
    for (const line of lines) {
      if (line.includes("##[group]")) {
        starts.push(lineNumber);
      } else if (line.includes("##[endgroup]")) {
        ends.push(lineNumber);
      }
      lineNumber += 1;
    }
    let ranges = [];
    for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
      ranges.push({
        start: starts[i] + 1,
        end: ends[i] + 1,
        kind: monaco.languages.FoldingRangeKind.Imports,
      });
    }
    return ranges;
  }

  renderLogViewer(check) {
    let log = null;
    let isShowing = false;
    const radios = ["Minimal", "All"];
    if (check.log.shown) {
      isShowing = true;
      if (check.log.text) {
        let logText = null;
        if (check.log.logLevel === "All") {
          logText = check.log.text;
        } else {
          logText = filterLog(check.log.text);
        }

        const totalLines = (logText.match(/\n/g) || "").length + 1;
        if (check.log.existingEditor) {
          check.log.existingEditor.setValue(logText);
          check.log.existingEditor.revealLine(totalLines);
        }

        log = (
          <div
            style={{
              marginBottom: "20px",
            }}
          >
            <div className="hideRadio">
              <span>Log Level: </span>
              <div style={{ display: "inline" }}>
                <ButtonGroup>
                  {radios.map((radio, idx) => (
                    <ToggleButton
                      key={idx}
                      id={`radio-${idx}`}
                      type="radio"
                      variant="outline-info"
                      name="radio"
                      value={radio}
                      checked={check.log.logLevel === radio}
                      onChange={(e) => {
                        check.log.logLevel = radio;
                        this.setState(this.state);
                      }}
                    >
                      {radio}
                    </ToggleButton>
                  ))}
                </ButtonGroup>
              </div>
            </div>
            <Editor
              height="80vh"
              defaultLanguage="logText"
              defaultValue={logText}
              theme="logTheme"
              beforeMount={(monaco) => {
                const groupRanges = this.getGroupRanges(monaco, logText);
                registerLogLanguage(monaco, groupRanges);
              }}
              options={{
                scrollBeyondLastLine: false,
                lineNumbersMinChars: totalLines.toString().length + 1,
                folding: true,
              }}
              onMount={(editor, monaco) => {
                check.log.existingEditor = editor;
                let foldAction = editor.getAction("editor.foldAll");
                foldAction.run().then(() => {
                  editor.revealLine(totalLines);
                });
              }}
              loading={<p>Loading viewer...</p>}
            />
          </div>
        );
      } else {
        log = <p>Fetching logs...</p>;
      }
    }
    return [log, isShowing];
  }

  getArtifactName(checkName) {
    return (
      checkName
        .replace("(", "")
        .replace(")", "")
        .replace("test ", "test-reports-test-")
        .replaceAll(", ", "-") + ".zip"
    );
  }

  renderChecks(checkRuns, s3Artifacts) {
    const checks = [];
    const testResultArtifacts = {};
    if (!s3Artifacts) {
      s3Artifacts = [];
    }
    let artifactsByName = {};
    for (const artifact of s3Artifacts) {
      let prefix = artifact.Key["#text"];
      let name = prefix.split("/").slice(-1)[0];
      artifactsByName[name] = artifact;
    }

    for (const [index, check] of checkRuns.entries()) {
      // Show the log viewer + toggle chevron
      const toggle = () => {
        check.log.shown = !check.log.shown;
        this.setState(this.state);
      };
      const [log, isShowing] = this.renderLogViewer(check);
      const iconStyle = { cursor: "pointer" };
      let icon = <BsFillCaretRightFill style={iconStyle} onClick={toggle} />;
      if (isShowing) {
        icon = <BsFillCaretDownFill style={iconStyle} onClick={toggle} />;
      }

      // Determine the check's status and turn that into an icon
      const statuses = {
        SUCCESS: <GoCheck style={{ color: "#22863a" }} />,
        FAILURE: <GoX style={{ color: "#cb2431" }} />,
        NEUTRAL: <GoCircleSlash style={{ color: "#959da5" }} />,
        CANCELLED: <GoCircleSlash style={{ color: "rgb(255 86 86)" }} />,
      };
      let statusIcon = statuses[check.conclusion] || (
        <GoPrimitiveDot style={{ color: "#dbab09" }} />
      );

      let renderResultsButton = null;
      let artifactDetails = null;
      let artifactName = this.getArtifactName(check.name);
      if (artifactsByName[artifactName]) {
        const artifact = artifactsByName[artifactName];
        const size = formatBytes(parseInt(artifact.Size["#text"]));
        renderResultsButton = (
          <button
            style={{ marginLeft: "5px", fontSize: "0.7em", fontWeight: "bold" }}
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
            {artifact.showReport ? "Hide" : `Tests (${size})`}
          </button>
        );
        testResultArtifacts[artifact.Key["#text"]] = true;
        let prefix = artifact.Key["#text"];
        check.artifactUrl = `https://gha-artifacts.s3.amazonaws.com/${prefix}`;
        check.artifact = artifact;

        if (artifact.showReport) {
          const key = `s3-${check.name}-${artifactName}`;
          let prefix = artifact.Key["#text"];
          let url = `https://gha-artifacts.s3.amazonaws.com/${prefix}`;
          artifactDetails = (
            <TestReportRenderer testReportZip={url} key={key} />
          );
        }
      }
      checks.push({
        data: check,
        element: (
          <div style={{ marginBottom: "2px" }} key={"check-run-" + index}>
            {statusIcon} <a href={check.detailsUrl}>{check.name}</a> {icon}{" "}
            {log}
            {renderResultsButton}
            {artifactDetails}
          </div>
        ),
      });
    }
    return [checks, testResultArtifacts];
  }

  renderArtifact(args) {
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

  renderGitHubArtifacts(run) {
    let artifacts = [];
    for (const [index, artifact] of run.artifacts.artifacts.entries()) {
      // The URL in the response is for the API, not browsers, so make it
      // manually
      let url = `https://github.com/${this.props.user}/${this.props.repo}/suites/${run.databaseId}/artifacts/${artifact.id}`;
      if (artifact.name.startsWith("test-reports-")) {
        continue;
      }
      artifacts.push(
        this.renderArtifact({
          kind: "gha",
          index: index,
          name: artifact.name,
          size_in_bytes: artifact.size_in_bytes,
          url: url,
          expired: artifact.expired,
        })
      );
    }
    return artifacts;
  }

  renderS3Artifacts(run, testResultArtifacts) {
    let artifacts = [];
    if (run.s3_artifacts) {
      for (const [index, artifact] of run.s3_artifacts.entries()) {
        if (testResultArtifacts[artifact.Key["#text"]]) {
          // Already shown inline with a step, so don't show it again
          continue;
        }
        let prefix = artifact.Key["#text"];
        let url = `https://gha-artifacts.s3.amazonaws.com/${prefix}`;

        artifacts.push(
          this.renderArtifact({
            kind: "s3",
            index: index,
            name: prefix.split("/").slice(-1),
            size_in_bytes: parseInt(artifact.Size["#text"]),
            url: url,
            expired: false,
          })
        );
      }
    }
    return artifacts;
  }

  mergeStatuses(statuses) {
    if (statuses.length === 0) {
      return "SKIPPED";
    }
    const counts = {
      FAILURE: 0,
      NEUTRAL: 0,
      CANCELLED: 0,
      SUCCESS: 0,
    };
    for (const status of statuses) {
      counts[status] += 1;
    }
    if (counts.FAILURE > 0) {
      return "FAILURE";
    }
    if (counts.NEUTRAL + counts.CANCELLED === statuses.length) {
      return "SKIPPED";
    }
    if (counts.SUCCESS === statuses.length) {
      return "SUCCESS";
    }
    if (counts.NEUTRAL === statuses.length) {
      return "SKIPPED";
    }
    return "PENDING";
  }

  renderGroups(groups) {
    let cards = [];
    for (const [title, data] of Object.entries(groups)) {
      if (!data.show) {
        continue;
      }
      let isExpanded = this.state.showGroups.includes(title);
      const toggleGroup = () => {
        if (this.state.showGroups.includes(title)) {
          this.state.showGroups.pop(this.state.showGroups.indexOf(title));
        } else {
          this.state.showGroups.push(title);
        }
        this.setState(this.state);
      };

      let icon = (
        <BsFillCaretRightFill
          style={{ cursor: "pointer" }}
          onClick={toggleGroup}
        />
      );
      let items = [];
      if (isExpanded) {
        icon = (
          <BsFillCaretDownFill
            style={{ cursor: "pointer" }}
            onClick={toggleGroup}
          />
        );
        items = data.items;
      }
      let card = (
        <Card key={"group-card-" + title}>
          <Card.Body>
            <Card.Title>
              {title} {icon}
            </Card.Title>
            {items}
          </Card.Body>
        </Card>
      );
      cards.push({ data: { status: "GROUP" }, element: card });
    }
    return cards;
  }

  renderCommitSelector() {
    if (
      !this.state.pr ||
      !this.state.pr.allCommits ||
      this.state.pr.allCommits.length === 0
    ) {
      return null;
    }
    let items = [];
    for (const oid of this.state.pr.allCommits) {
      items.push(
        <option key={`oid-${oid}`} value={oid}>
          {oid.substring(0, 7)}
        </option>
      );
    }
    let loading = null;
    if (this.state.loadingNewCommit) {
      loading = (
        <span style={{ marginLeft: "10px" }}>
          <Spin text="Loading" />
        </span>
      );
    }
    return (
      <div style={{ margin: "4px" }}>
        <span>
          Commit:{" "}
          <a
            href={`https://github.com/pytorch/pytorch/commit/${this.state.commit.oid}`}
          >
            {this.state.commit.messageHeadline}
          </a>
        </span>
        <select
          style={{
            marginLeft: "10px",
            borderRadius: "4px",
          }}
          onChange={async (e) => {
            this.setState({ loadingNewCommit: true });
            await this.update({ selectedCommit: e.target.value });
          }}
        >
          {items}
        </select>
        {loading}
      </div>
    );
  }

  render() {
    let runs = [];
    let groups = {
      "Add annotations": {},
      "Close stale pull requests": {},
      "Label PRs & Issues": {},
      Triage: {},
      "Update S3 HTML indices for download.pytorch.org": {},
    };
    Object.entries(groups).forEach((x) => {
      x[1].show = false;
      x[1].items = [];
    });

    if (this.state.runs) {
      // Render all of the check runs as a list

      for (const [run_index, run] of this.state.runs.entries()) {
        const [checksData, testResultArtifacts] = this.renderChecks(
          run.checkRuns.nodes,
          run.s3_artifacts
        );
        const checks = checksData.map((x) => x.element);

        let artifacts = [];

        // List out artifacts hosted on GitHub
        if (run.artifacts) {
          if (run.artifacts.artifacts !== undefined) {
            artifacts = artifacts.concat(this.renderGitHubArtifacts(run));
          } else {
            artifacts.push(
              <div key={`artifact-${run.databaseId}`}>
                <span>Can't query artifacts (hit GitHub rate limit)</span>
              </div>
            );
          }
        }

        // List out artifacts from s3
        artifacts = artifacts.concat(
          this.renderS3Artifacts(run, testResultArtifacts)
        );

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
            <Card.Body
              style={{
                backgroundColor:
                  run.status === "FAILURE" ? "rgb(255 243 243)" : null,
              }}
            >
              <Card.Title>
                <a href={run.workflowRun.url}>{title}</a>
              </Card.Title>
              <div>
                {checksElement}
                {artifactsElement}
              </div>
            </Card.Body>
          </Card>
        );

        // Some jobs are uninteresting and there are a bunch of them, so group
        // them all together here
        if (title in groups) {
          groups[title].show = true;
          if (this.state.showGroups.includes(title)) {
            groups[title].show = true;
            groups[title].items.push(card);
          }
        } else {
          // A normal job, show it without any extras
          runs.push({ data: run, element: card });
        }
      }
    }

    // Groups are all stored in the 'groups' map, so add them to the list of runs
    // as cards
    runs = runs.concat(this.renderGroups(groups));

    let loading = null;
    if (this.state.error_message) {
      loading = <p style={{ color: "red" }}> {this.state.error_message}</p>;
    } else if (!this.state.commit) {
      loading = <p>Loading... (make sure you are signed in)</p>;
    }

    if (this.state.statuses) {
      for (const status of this.state.statuses) {
        if (!status.targetUrl.includes("https://circleci.com")) {
          continue;
        }
        status.status = status.state;
        runs.push({
          data: status,
          element: <CircleCICard key={status.context} status={status} />,
        });
      }
    }

    let displayRuns = [];
    function add(type) {
      for (const run of runs) {
        if (run.data.status === type) {
          run.used = true;
          displayRuns.push(
            <div key={run.data.databaseId} style={{ marginBottom: "4px" }}>
              {run.element}
            </div>
          );
        }
      }
    }
    add("FAILURE");
    add("PENDING");
    add("SUCCESS");
    add("GROUP");
    add("SKIPPED");

    for (const run of runs) {
      if (!run.used) {
        console.error("Unused run with state", run.data.status);
      }
    }

    const failures = runs.filter((run) => run.data.status === "FAILURE");
    let report = null;
    if (failures.length > 0) {
      report = (
        <FailureReport
          user={this.props.user}
          repo={this.props.repo}
          failures={failures}
        />
      );
    }

    if (this.state.runs && displayRuns.length === 0) {
      displayRuns = <p style={{ fontWeight: "bold" }}>No jobs found</p>;
    }

    return (
      <div>
        {this.renderTitle()}
        {this.renderDiff()}
        {this.renderBody()}
        {loading}

        {this.renderDocPreviewButton()}
        {this.renderCommitSelector()}
        {report}
        <div>{displayRuns}</div>
      </div>
    );
  }
}

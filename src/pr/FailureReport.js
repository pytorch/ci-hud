import React, { Component } from "react";
import Card from "react-bootstrap/Card";
import Tooltip from "rc-tooltip";
import TestReportRenderer from "./TestReportRenderer";
import { github } from "../utils.js";
import Spin from "../Spin.js";
import Editor from "@monaco-editor/react";
import { registerLogLanguage } from "./logs.js";
import {
  BsFillQuestionCircleFill,
  BsFillCaretRightFill,
  BsFillCaretDownFill,
} from "react-icons/bs";

function help(text) {
  return (
    <Tooltip
      key="help"
      overlay={text}
      mouseLeaveDelay={0}
      placement="rightTop"
      destroyTooltipOnHide={{ keepParent: false }}
    >
      <span style={{ fontSize: "16px", color: "#a1a1a1", cursor: "pointer" }}>
        <BsFillQuestionCircleFill />
      </span>
    </Tooltip>
  );
}

function posToLine(text, idx) {
  return (text.substring(0, idx).match(/\n/g) || "").length;
}

function guessRelevantLine(text, totalLines) {
  const genregex = () => {
    try {
      return new RegExp("(?<!if-no-files-found: )error", "g");
    } catch(e) {
      return new RegExp("error", "g");
    }
  };
  const regex = genregex();
  const idx = Array.from(text.matchAll(regex)).slice(
    -1
  )[0].index;
  const line = posToLine(text, idx);
  return line;
}

class LogViewer extends Component {
  constructor(props) {
    super(props);
    this.state = {};
  }

  componentDidMount() {
    this.update();
  }

  async update() {
    let response = await github.raw(this.props.url);
    let text = await response.text();
    if (this.props.transform) {
      text = this.this.props.transform(text);
    }
    const totalLines = (text.match(/\n/g) || "").length + 1;
    this.setState({ text, totalLines });
  }

  render() {
    if (!this.state.text) {
      return <Spin text={"Downloading logs"} />;
    }

    let height = 15;
    return (
      <Editor
        height={`${height}em`}
        defaultLanguage="logText"
        defaultValue={this.state.text}
        theme="logTheme"
        beforeMount={(monaco) => {
          const groupRanges = [];
          registerLogLanguage(monaco, groupRanges);
        }}
        options={{
          scrollBeyondLastLine: false,
          lineNumbersMinChars: this.state.totalLines.toString().length + 1,
          folding: true,
        }}
        onMount={(editor, monaco) => {
          let foldAction = editor.getAction("editor.foldAll");
          foldAction.run().then(() => {
            let line = parseInt(
              guessRelevantLine(this.state.text, this.state.totalLines) +
                height / 2
            );
            editor.revealLine(line);
          });
        }}
        loading={<Spin text={"Loading viewer"} />}
      />
    );
  }
}

export default class FailureReport extends Component {
  constructor(props) {
    super(props);
    this.state = {};
    this.state.shown = true;
  }

  componentDidMount() {
    this.update();
  }

  async update() {}

  render() {
    let items = [];
    for (const failure of this.props.failures) {
      let failedSteps = [];
      if (failure.data.state !== undefined) {
        // CircleCI not supported
        continue;
      } else {
        failedSteps = failure.data.checkRuns.nodes.filter(
          (x) => x.conclusion === "FAILURE"
        );
      }
      const workflow = failure.data.workflowRun.workflow.name;
      let details = null;
      for (const step of failedSteps) {
        if (step.name.startsWith("test (") && !step.incorrectReport) {
          if (!step.artifactUrl) {
            details = (
              <div>
                <Spin text={"Loading test report"} />
              </div>
            );
          } else {
            // test failure, try to download report
            details = (
              <TestReportRenderer
                testReportZip={step.artifactUrl}
                noSummary={true}
                onLoaded={(failures, totals, testInfo) => {
                  if (failures.length === 0) {
                    step.incorrectReport = true;
                    this.setState(this.state);
                  }
                }}
              />
            );
          }
        } else {
          // otherwise, open up the log viewer
          details = (
            <LogViewer
              url={`repos/${this.props.user}/${this.props.repo}/actions/jobs/${step.databaseId}/logs`}
            />
          );
          // details = <p>todo: small log viewer</p>;
        }
        items.push(
          <div
            style={{ marginBottom: "10px" }}
            key={`fr-${workflow}-${step.name}`}
          >
            <span style={{ fontWeight: "bold" }}>
              {workflow} / {step.name}{" "}
              {step.incorrectReport
                ? help(
                    "The XML test report for this job had no failures, but the job failed. This usually means something went wrong outside of a Python unittest."
                  )
                : null}
            </span>
            {details}
          </div>
        );
      }
    }

    const toggle = () => {
      this.setState({ shown: !this.state.shown });
    };

    let icon = (
      <BsFillCaretRightFill style={{ cursor: "pointer" }} onClick={toggle} />
    );
    if (this.state.shown) {
      icon = (
        <BsFillCaretDownFill style={{ cursor: "pointer" }} onClick={toggle} />
      );
    }
    if (items.length === 0) {
      return null;
    }
    return (
      <Card
        style={{
          marginBottom: "15px",
          boxShadow: "rgb(255 113 113) 0px 0px 9px -3px",
          border: "1px solid #ff6060",
        }}
      >
        <Card.Body>
          <Card.Title>
            GHA Failure Report{" "}
            {help("Aggregated information from all failed jobs")} {icon}
          </Card.Title>
          {this.state.shown ? items : null}
        </Card.Body>
      </Card>
    );
  }
}

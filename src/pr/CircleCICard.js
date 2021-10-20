import React, { Component } from "react";
import Card from "react-bootstrap/Card";
import ButtonGroup from "react-bootstrap/ButtonGroup";
import ToggleButton from "react-bootstrap/ToggleButton";
import Button from "react-bootstrap/Button";
import Editor from "@monaco-editor/react";
import { filterLog, registerLogLanguage } from "./logs.js";

import {
  BsFillCaretRightFill,
  BsCaretDownFill,
  BsFillCaretDownFill,
  GoPrimitiveDot,
  GoCircleSlash,
  GoCheck,
  GoX,
} from "react-icons/all";

export default class CircleCICard extends Component {
  constructor(props) {
    super(props);
    let buildMatch = props.status.targetUrl.match(/pytorch\/pytorch\/(\d+)/);
    this.state = {
      showSteps: {},
    };

    if (buildMatch) {
      let buildId = buildMatch[1];
      this.state.url = `https://circleci.com/api/v1.1/project/gh/pytorch/pytorch/${buildId}`;
    }
  }

  hasError() {
    return this.state.errorMessage !== undefined;
  }

  async componentDidUpdate(prevProps, prevState) {
    if (this.hasError()) {
      return;
    }
    if (!this.state.data) {
      return;
    }
    for (const step of this.state.data.steps) {
      if (!step.log.shown || step.log.text !== undefined) {
        continue;
      }

      fetch(step.actions[0].output_url)
        .then((log) => log.text())
        .then((log) => {
          step.log.text = log.replaceAll("\\n", "\n").replaceAll("\\r", "");
          this.setState(this.state);
        });
    }
  }

  componentDidMount() {
    this.update();
  }

  async update() {
    let response = await fetch(this.state.url);
    let data = await response.json();
    delete data.circle_yml;

    for (const step of data.steps) {
      step.log = {
        text: undefined,
        shown: false,
        logLevel: "Minimal",
      };
    }

    this.setState({ data: data });
  }

  renderStatusIcon(status) {
    status = status.toUpperCase();
    // Determine the check's status and turn that into an icon
    const statuses = {
      SUCCESS: <GoCheck style={{ color: "#22863a" }} />,
      FAILURE: <GoX style={{ color: "#cb2431" }} />,
      FAILED: <GoX style={{ color: "#cb2431" }} />,
      TIMEDOUT: <GoX style={{ color: "#cb2431" }} />,
      NEUTRAL: <GoCircleSlash style={{ color: "#959da5" }} />,
      CANCELLED: <GoCircleSlash style={{ color: "rgb(255 86 86)" }} />,
    };

    return statuses[status] || <GoPrimitiveDot style={{ color: "#dbab09" }} />;
  }

  renderLogViewer(step) {
    let log = null;
    let isShowing = false;
    const radios = ["Minimal", "All"];
    if (step.log.shown) {
      isShowing = true;
      if (step.log.text) {
        let logText = null;
        if (step.log.logLevel == "All") {
          logText = step.log.text;
        } else {
          logText = filterLog(step.log.text);
        }

        const totalLines = (logText.match(/\n/g) || "").length + 1;
        let existingEditor = null;
        if (step.log.existingEditor) {
          step.log.existingEditor.setValue(logText);
          step.log.existingEditor.revealLine(totalLines);
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
                      checked={step.log.logLevel === radio}
                      onChange={(e) => {
                        step.log.logLevel = radio;
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
                const groupRanges = [];
                registerLogLanguage(monaco, groupRanges);
              }}
              options={{
                scrollBeyondLastLine: false,
                lineNumbersMinChars: totalLines.toString().length + 1,
                folding: true,
              }}
              onMount={(editor, monaco) => {
                step.log.existingEditor = editor;
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
    return log;
  }

  render() {
    const status = this.props.status;

    let stepsElement = null;
    let artifactsElement = null;

    if (this.state.data) {
      let steps = [];
      for (const [i, step] of this.state.data.steps.entries()) {
        const name = step.name;
        const logUrl = step.actions[0].output_url;

        let statusIcon = this.renderStatusIcon(step.actions[0].status);
        const iconStyle = { cursor: "pointer" };
        // Show the log viewer + toggle chevron
        const toggle = () => {
          step.log.shown = !step.log.shown;
          this.setState(this.state);
        };
        let icon = <BsFillCaretRightFill style={iconStyle} onClick={toggle} />;
        if (step.log.shown) {
          icon = <BsFillCaretDownFill style={iconStyle} onClick={toggle} />;
        }

        steps.push(
          <div
            style={{ marginBottom: "2px" }}
            key={`status-${status.context}-${name}-${i}`}
          >
            {statusIcon} <span>{name}</span> {icon} {this.renderLogViewer(step)}
            {/* TODO: These are unimplemented for now since CircleCI provides
             a good view into them already */}
            {/* {renderResultsButton} */}
            {/* {artifactDetails} */}
          </div>
        );
      }
      stepsElement = <div style={{ padding: "6px" }}>{steps}</div>;
    }

    return (
      <Card key={"card-" + status.context}>
        <Card.Body
          style={{
            backgroundColor:
              status.state === "FAILURE" ? "rgb(255 243 243)" : null,
          }}
        >
          <Card.Title>
            <a href={status.targetUrl}>{status.context}</a>
          </Card.Title>
          <div>
            {stepsElement}
            {artifactsElement}
          </div>
        </Card.Body>
      </Card>
    );
  }
}

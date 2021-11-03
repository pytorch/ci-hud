// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Component } from "react";
import Card from "react-bootstrap/Card";
import { highlightElement } from "highlight.js";
import { strFromU8, unzipSync } from "fflate";
import { GoCheck } from "react-icons/go";
import Spin from "../Spin.js";

import { parseXml } from "../utils.js";

class TestSuite extends Component {
  constructor(props) {
    super(props);
    this.nodeRef = React.createRef();
  }

  componentDidMount() {
    this.highlight();
  }

  highlight = () => {
    if (this.nodeRef) {
      highlightElement(this.nodeRef.current.children[0], {
        language: "python",
      });
    }
  };

  render() {
    const tcase = this.props.testcase;
    let failure = tcase.failure || tcase.error;

    let failures = null;
    if (Array.isArray(failure)) {
      failures = failure;
    } else {
      failures = [failure];
    }

    let content = failures.map((f) => f.textContent.trim()).join("\n\n");

    let fileinfo = null;
    if (tcase.file && tcase.line) {
      fileinfo = (
        <span style={{ color: "grey" }}>
          {tcase.file}:{tcase.line}:
        </span>
      );
    }
    return (
      <Card
        style={{
          fontFamily: '"Monaco", monospace',
          marginTop: "5px",
          backgroundColor: "#ffe5e5",
        }}
      >
        <Card.Body>
          <div>
            <p>
              {fileinfo}
              {tcase.classname}.{tcase.name}
            </p>
            <pre ref={this.nodeRef}>
              <code className="language-python">{content}</code>
            </pre>
          </div>
        </Card.Body>
      </Card>
    );
  }
}

class TestSummary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      showDetail: false,
    };
  }

  render() {
    const toggle = () => {
      const prev = this.state.showDetail;
      this.setState({ showDetail: !prev });
    };
    let suiteDetail = null;

    let data = [];
    for (const [filename, classes] of Object.entries(this.props.info)) {
      for (const [classname, stats] of Object.entries(classes)) {
        stats.filename = filename;
        stats.classname = classname;
        data.push(stats);
      }
    }
    data = data.sort((a, b) => {
      a = a.passed + a.error;
      b = b.passed + b.error;
      return b - a;
    });
    let totals = {
      passed: 0,
      error: 0,
      skipped: 0,
    };
    for (const item of data) {
      totals.passed += item.passed;
      totals.error += item.error;
      totals.skipped += item.skipped;
    }
    if (this.state.showDetail) {
      let rows = [];
      for (const classStats of data) {
        let filename = classStats.filename.split("/").slice(-1)[0];
        let name = `${filename}:${classStats.classname}`;
        rows.push(
          <tr
            style={{
              fontSize: "12px",
              backgroundColor: classStats.error > 0 ? "#ffe4e4" : "white",
            }}
            key={name}
          >
            <td style={{ fontFamily: '"Monaco", monospace' }}>
              <span style={{ color: "grey" }}>{filename}:</span>
              <span>{classStats.classname}</span>
            </td>
            <td className="center">{classStats.passed}</td>
            <td className="center">{classStats.error}</td>
            <td className="center">{classStats.skipped}</td>
          </tr>
        );
      }
      suiteDetail = (
        <table style={{ marginTop: "6px" }} className="table">
          <thead>
            <tr>
              <th className="center">Name</th>
              <th className="center">Passed</th>
              <th className="center">Errors</th>
              <th className="center">Skipped</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      );
    }
    return (
      <Card
        style={{
          marginTop: "5px",
        }}
      >
        <Card.Body>
          <Card.Title style={{ marginBottom: 0 }}>Test Summary</Card.Title>
          <div>
            <p style={{ marginBottom: 0 }}>
              Ran {this.props.totals.cases} test cases in{" "}
              {this.props.totals.classes} classes from {this.props.totals.files}{" "}
              files
            </p>
            <p style={{ marginBottom: 0 }}>
              {totals.passed} tests passed, {totals.error} tests failed,{" "}
              {totals.skipped} tests skipped
              <button
                style={{ marginLeft: "10px", fontSize: "0.8em" }}
                className="btn btn-secondary"
                onClick={toggle}
              >
                {this.state.showDetail ? "Hide" : "Show"} Details
              </button>
            </p>
            {suiteDetail}
          </div>
        </Card.Body>
      </Card>
    );
  }
}

// Given a URL to a .zip of test reports (as we have in CI), download it then
// render a summary + the failures in a nice way
export default class TestReportRenderer extends Component {
  constructor(props) {
    super(props);
    this.state = {};
  }
  componentDidMount() {
    this.update().catch((error) => {
      console.error(error);
      this.setState({ updateFailure: error.toString() });
    });
  }

  async update() {
    // Download the test report
    let buf = await fetch(this.props.testReportZip).then((r) =>
      r.arrayBuffer()
    );
    let reports = {};

    const file = new Uint8Array(buf);
    let inner = unzipSync(file);
    for (const innerFilename in inner) {
      let key = innerFilename
        .replace("test/test-reports/", "")
        .replace(".xml", "");
      reports[key] = parseXml(strFromU8(inner[innerFilename]));
    }

    let suites = [];
    for (const filename in reports) {
      let data = reports[filename];
      if (data.testsuite) {
        suites.push(data.testsuite);
      } else if (data.testsuites) {
        if (Array.isArray(data.testsuites.testsuite)) {
          for (const suite of data.testsuites.testsuite) {
            suites.push(suite);
          }
        } else if (data.testsuites.testsuite) {
          suites.push(data.testsuites.testsuite);
        }
      } else {
        console.error("Unknown report type", data);
      }
    }

    let failures = [];
    let testInfo = {};
    const totals = {
      classes: 0,
      cases: 0,
      files: 0,
      time: 0,
    };
    for (const suite of suites) {
      let numErrors = +suite.errors;
      let numFailures = +suite.failures;
      let cases = suite.testcase;
      if (!Array.isArray(cases)) {
        cases = [cases];
      }
      if (numErrors + numFailures > 0) {
        for (const testcase of cases) {
          if (testcase.failure || testcase.error) {
            failures.push(testcase);
          }
        }
      }

      const getStatus = (testcase) => {
        if (testcase.skipped) {
          return "skipped";
        }
        if (testcase.error || testcase.failure) {
          return "error";
        }
        return "passed";
      };
      for (const testcase of cases) {
        totals.cases += 1;
        if (!testInfo[testcase.file]) {
          testInfo[testcase.file] = {};
          totals.files += 1;
        }
        if (!testInfo[testcase.file][testcase.classname]) {
          totals.classes += 1;
          testInfo[testcase.file][testcase.classname] = {
            passed: 0,
            error: 0,
            skipped: 0,
            time: 0,
            cases: 0,
          };
        }
        totals.time += +testcase.time;
        testInfo[testcase.file][testcase.classname][getStatus(testcase)] += 1;
        testInfo[testcase.file][testcase.classname].cases += 1;
        testInfo[testcase.file][testcase.classname].time += +testcase.time;
      }
    }
    if (this.props.onLoaded) {
      this.props.onLoaded(failures, totals, testInfo);
    }

    this.setState({
      failures: failures,
      totals: totals,
      testInfo: testInfo,
    });
  }

  renderSummary() {}

  render() {
    if (!this.state.failures) {
      if (this.state.updateFailure) {
        return (
          <p style={{ color: "red" }}>
            Loading/parsing failed: {this.state.updateFailure}
          </p>
        );
      }
      return <Spin text="Loading test results" />;
    }

    let results = [];

    const summary = (
      <TestSummary info={this.state.testInfo} totals={this.state.totals} />
    );

    if (this.state.failures.length === 0) {
      return (
        <div>
          {this.props.noSummary ? null : summary}
          <Card
            style={{
              marginTop: "5px",
              backgroundColor: "#ebffeb",
            }}
          >
            <Card.Body>
              <Card.Title style={{ marginBottom: 0 }}>
                <GoCheck style={{ color: "#22863a" }} />{" "}
                <span>All tests passed</span>
              </Card.Title>
            </Card.Body>
          </Card>
        </div>
      );
    }

    let i = 0;
    for (let testcase of this.state.failures) {
      results.push(<TestSuite key={i++} testcase={testcase} />);
    }

    return (
      <div>
        {this.props.noSummary ? null : summary}
        {results}
      </div>
    );
  }
}

// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Component } from "react";
import Card from "react-bootstrap/Card";
import { highlightElement } from "highlight.js";
import { strFromU8, unzipSync } from "fflate";

import { parseXml, formatBytes, asyncAll, s3, github } from "../utils.js";

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
      let code = this.nodeRef.current.children[0];
      highlightElement(this.nodeRef.current.children[0], {
        language: "python",
      });
    }
  };

  render() {
    const tcase = this.props.testcase;
    const failure = tcase.failure || tcase.error;
    return (
      <Card
        style={{
          fontFamily: '"Monaco", monospace',
          marginTop: "5px",
          backgroundColor: "#ffe5e5",
        }}
      >
        <Card.Body>
          <Card.Title>
            <p style={{ fontSize: "0.8em" }}>
              {tcase.classname}.{tcase.name}
            </p>
          </Card.Title>
          <div>
            <div style={{ fontSize: "0.8em" }}>
              {tcase.file}:{tcase.line} {failure.type}
            </div>
            <pre ref={this.nodeRef}>
              <code className="language-python">
                {failure.textContent.trim()}
              </code>
            </pre>
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
      this.state.updateFailure = error.toString();
      this.setState(this.state);
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
        } else {
          suites.push(data.testsuites.testsuite);
        }
      } else {
        console.error("unknown report type", data);
      }
    }

    let failures = [];
    for (const suite of suites) {
      let numErrors = +suite.errors;
      let numFailures = +suite.failures;
      if (numErrors + numFailures > 0) {
        for (const testcase of suite.testcase) {
          if (testcase.failure || testcase.error) {
            failures.push(testcase);
          }
        }
      }
    }

    this.state.failures = failures;
    this.setState(this.state);
  }

  render() {
    if (!this.state.failures) {
      if (this.state.updateFailure) {
        return (
          <p style={{ color: "red" }}>
            Loading/parsing failed:{this.state.updateFailure}
          </p>
        );
      }
      return <p>loading and parsing test results...</p>;
    }

    let results = [];

    if (this.state.failures.length == 0) {
      return <p>all tests passed</p>;
    }

    let i = 0;
    for (let testcase of this.state.failures) {
      results.push(<TestSuite key={i++} testcase={testcase} />);
    }

    return <div>{results}</div>;
  }
}

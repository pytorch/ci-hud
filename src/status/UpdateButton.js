import React, { Component } from "react";
import Tooltip from "rc-tooltip";
import Spin from "../Spin.js";

// Button for triggering a GitHub Actions workflow to update the JSON backing
// this user/repo/branch combo. If the user is not logged in, nothing is shown.
// Otherwise, the button uses the GitHub OAuth token to trigger a
// workflow_dispatch event for the relevant file.
export default class UpdateButton extends Component {
  constructor(props) {
    super(props);
    this.state = {
      status: "waiting",
    };
  }

  render() {
    const token = localStorage.getItem("gh_pat");
    if (!token) {
      // Not logged in, don't show anything
      return null;
    }

    // This should match the generated files here:
    // https://github.com/pytorch/ci-hud/tree/main/.github/workflows
    const workflowFile = `generated-update-github-status-${this.props.user}-${
      this.props.repo
    }-${this.props.branch.replace("/", "-")}.yml`;

    if (this.state.status === "waiting") {
      // No user actions yet, show the button
      return (
        <Tooltip
          overlay={`Send a 'workflow_dispatch' event to GitHub Actions to run ${workflowFile}`}
          mouseLeaveDelay={0}
          placement="rightTop"
          destroyTooltipOnHide={{ keepParent: false }}
        >
          <button
            className="btn btn-info"
            style={{
              fontSize: "0.8em",
              padding: "3px 8px 3px 8px",
              marginLeft: "3px",
            }}
            onClick={async () => {
              const url = `https://api.github.com/repos/pytorch/ci-hud/actions/workflows/${workflowFile}/dispatches`;
              const body = {
                ref: "main",
              };

              this.setState({ status: "sent" });

              // Send in the request
              fetch(url, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
              })
                .then((r) => r.text())
                .then((r) => {
                  // Check if response has an error (it's empty if successful)
                  if (r.includes("Not Found")) {
                    // GitHub might send this back if the workflow name in the request
                    // doesn't exist
                    this.setState({ status: "error" });
                  } else {
                    this.setState({ status: "dispatched" });
                  }
                })
                .catch(() => {});
            }}
          >
            Update now
          </button>
        </Tooltip>
      );
    } else if (this.state.status === "sent") {
      return <Spin text="Sending" />;
    } else if (this.state.status === "dispatched") {
      return (
        <span>
          <a
            target="_blank"
            rel="noreferrer"
            href={`https://github.com/pytorch/ci-hud/actions/workflows/${workflowFile}`}
          >
            Successfully dispatched
          </a>
        </span>
      );
    } else if (this.state.status === "error") {
      // Users shouldn't see this so something has gone wrong if they are
      return <span>Unable to dispatch (file a bug)</span>;
    }
  }
}

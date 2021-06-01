import React, { Component } from "react";
import "@toast-ui/chart/dist/toastui-chart.css"
import Chart from "@toast-ui/chart";

export default class GitHubActionsDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = {};
  }
  componentDidMount() {
    this.update();
  }
  async update() {
    const data = {
      actions_statuses: JSON.parse(
        await fetch(
          "https://ossci-checks-status.s3.amazonaws.com/status.json",
          { cache: "no-cache" }
        ).then((a) => a.text())
      ),
    };
    this.setState(data);
  }

  componentDidUpdate() {
    if (!this.state.actions_statuses) {
      return;
    }
    const series = {
      dates: [],
    };
    let keys = ["in_progress", "queued", "pending"];
    for (const key of keys) {
      series[key] = [];
    }
    this.state.actions_statuses.sort((a, b) => {
      return a.last_updated - b.last_updated;
    });
    for (const item of this.state.actions_statuses) {
      series.dates.push(new Date(item.last_updated * 1000).toLocaleString());
      for (const key of keys) {
        series[key].push(item[key] || 0);
      }
    }
    const data_series = [];
    for (const key of keys) {
      data_series.push({
        name: key,
        data: series[key],
      });
    }
    const data = {
      categories: series.dates,
      series: data_series
    }

    const el = document.getElementById("chart");
    el.innerHTML = "";
    const options = {};
    Chart.lineChart({ el, data, options });
  }

  render() {
    return (
      <div>
        <h2>GitHub Actions Status</h2>
        <div id="chart" style={{width: "600px", height: "400px"}}>
        </div>
      </div>
    );
  }
}

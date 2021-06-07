// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Component } from "react";
import "@toast-ui/chart/dist/toastui-chart.css";
import Chart from "@toast-ui/chart";

export default class JobCorrelationHeatmap extends Component {
  constructor(props) {
    super(props);
    this.state = {};
  }

  componentDidMount() {
    this.update();
  }

  correlateJobs(all_jobs) {
    let passes = ["success", "skipped", "pending", "queued"];
    const seen_names = {};
    const correlationMatrix = {};

    const addFailure = (failure1, failure2) => {
      seen_names[failure1] = true;
      seen_names[failure2] = true;
      if (!correlationMatrix[failure1]) {
        correlationMatrix[failure1] = [];
      }
      if (!correlationMatrix[failure1][failure2]) {
        correlationMatrix[failure1][failure2] = 0;
      }
      correlationMatrix[failure1][failure2] += 1;
    };

    for (const jobs of all_jobs) {
      let failures = [];
      for (const job_name in jobs.value) {
        const job = jobs.value[job_name];
        if (job.status && passes.indexOf(job.status) === -1) {
          failures.push(job_name);
        }
      }

      for (const failure1 of failures) {
        for (const failure2 of failures) {
          addFailure(failure1, failure2);
        }
      }
    }

    const job_names = Object.keys(seen_names).sort();

    const fullMatrix = [];
    for (const name1 of job_names) {
      const row = [];
      for (const name2 of job_names) {
        if (correlationMatrix[name1] && correlationMatrix[name1][name2]) {
          row.push(correlationMatrix[name1][name2]);
        } else {
          row.push(0);
        }
      }
      fullMatrix.push(row);
    }

    return [job_names, fullMatrix];
  }

  async update() {
    const base = "https://ossci-job-status.s3.amazonaws.com/master";
    const data = {
      job_index: JSON.parse(
        await fetch(`${base}/index.json`, { cache: "no-cache" }).then((a) =>
          a.text()
        )
      ),
    };
    const promises = data.job_index.map((job) => {
      return fetch(`${base}/${job.id}.json`).then((r) => r.json());
    });
    this.state.correlations = this.correlateJobs(
      await Promise.allSettled(promises)
    );
    this.setState(data);
  }

  tooltipTemplate(model, defaultTooltipTemplate, theme) {
    const { background } = theme;
    let [a, b] = model.data[0].label.split(", ");
    return `
        <div
        style="
    background: ${background};
    padding: 0 5px;
    text-align: center;
    color: white;">
        <div
        class="toastui-chart-tooltip-category"
        style="font-weight: bold; font-family: Arial, sans-serif; font-size: 13px; color: #ffffff;">
            ${a}
            <br />
            ${b}
        </div>
        <div
        class="toastui-chart-tooltip-series-wrapper"
        style="font-weight: normal; font-family: Arial, sans-serif; font-size: 12px; color: #ffffff;">
            <div class="toastui-chart-tooltip-series">
                <span class="toastui-chart-series-name">
                <i class="toastui-chart-icon" style="background: ${model.data[0].color}"></i>
                <span class="toastui-chart-name">${model.data[0].value}</span>
                </span>
            </div>
        </div>
    </div>
    `;
  }

  componentDidUpdate() {
    if (!this.state.correlations) {
      return;
    }

    const el = document.getElementById("job-correlations");
    let [job_names, correlationMatrix] = this.state.correlations;
    el.innerHTML = "";
    const options = {
      usageStatistics: false,
      xAxis: {
        label: {
          formatter: (a, b) => "",
        },
      },
      yAxis: {
        label: {
          formatter: (a, b) => "",
        },
      },
      tooltip: {
        template: this.tooltipTemplate,
      },
    };
    let data = {
      categories: {
        x: job_names,
        y: job_names,
      },
      series: correlationMatrix,
    };
    Chart.heatmapChart({ el, data, options });
  }

  render() {
    return (
      <div>
        <h2>CI Job Correlations</h2>
        <div
          id="job-correlations"
          style={{ width: "550px", height: "550px" }}
        ></div>
      </div>
    );
  }
}

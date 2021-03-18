import React, { Component, Fragment } from 'react';
import Tooltip from 'rc-tooltip';
import axios from 'axios';

function objToStrMap(obj) {
  let strMap = new Map();
  for (let k of Object.keys(obj)) {
    strMap.set(k, obj[k]);
  }
  return strMap;
}

// define the threshold to determine whether it is regression/optimization
const THRESHOLD = 0.10;
const ROUND_PRECISION = 100000;

function round_float(mean) {
  return Math.round(mean * ROUND_PRECISION) / ROUND_PRECISION;
}

export default class PerfHistoryDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = this.initialState();
  }
  initialState() {
    return {
      builds: [],
      known_jobs: [],
      jobNameFilter: "",
    }
  }
  componentDidMount() {
    this.update();
  }
  componentDidUpdate(prevProps) {
  }
  async update() {
    const url_prefix = 'http://s3.amazonaws.com/ossci-metrics/torchbench_v0_nightly';
    // branch: v0-nightly
    const indexes = await axios.get(`${url_prefix}/index.json`)
    console.log(indexes.data);
    const requests = indexes.data.map(async run => {
      try {
        const r = await axios.get(`${url_prefix}/${run.result.relpath}`)
        run.sb_map = objToStrMap(r.data);
      } catch(e) {
        run.sb_map = new Map();
      }
      return run;
    });
    const builds = await axios.all(requests);
    const known_jobs_set = new Set();
    // Use the oldest benchmark run as the standard
    const standard_benchmark = builds[0].sb_map.get("benchmarks");
    const benchmark_index = new Map();

    standard_benchmark.forEach((benchmark, index) => {
      known_jobs_set.add(benchmark["name"]);
      benchmark_index.set(benchmark["name"], index);
    });
    console.log(known_jobs_set);
    // Figure out if we think there is performance regression or not.
    // 1. If the test mean is >10% smaller than the previous mean, it is an optimization
    // 3. If the test mean is >10% larger than the previous mean, it is a regression
    // 4. Otherwise, it is a stable result
    for (let i = 0; i < builds.length; i++) {
      const sb_map = builds[i].sb_map;
      // Get the test
      sb_map.get("benchmarks").forEach((benchmark) => {
        const build_benchmark_mean = benchmark["stats"]["mean"];
        const build_benchmark_index = benchmark_index.get(benchmark["name"]);
        if (i === 0) {
          benchmark["stats"]["prev_mean"] = build_benchmark_mean;
        } else {
          const prev_mean = builds[i-1].sb_map.get("benchmarks")[build_benchmark_index]["stats"]["mean"];
          benchmark["stats"]["prev_mean"] = prev_mean;
        }
      });
    }

    builds.reverse();
 
    const data = {};
    data.known_jobs = [...known_jobs_set.values()].sort();
    data.benchmark_index = benchmark_index;
    data.builds = builds;
    this.setState(data);
  }

  shouldShowJob(name) {
     const jobNameFilter = this.state.jobNameFilter;
     if (jobNameFilter.length > 0 && !name.includes(jobNameFilter)) {
         return false;
     }
     return true;
  }
  
  render() {
    function gen_summary(delta) {
      delta = Math.round(delta * 10000) / 100;
      if (delta >= 0) {
        delta = "+" + delta;
      }
      delta += "%";
      return delta;
    }

    function is_optimized(delta) {
      return (delta < (-1 * THRESHOLD));
    }

    function is_regression(delta) {
      return (delta > THRESHOLD);
    }

    function result_icon(result) {
      if (is_optimized(result)) return <span role="img" style={{color:"green"}} aria-label="passed">0</span>;
      if (is_regression(result)) return <span role="img" style={{color:"red"}} aria-label="failed">X</span>;
      return <span role="img" style={{color:"grey"}} aria-label="passed">-</span>;
    }

    let builds = this.state.builds;
    const visible_jobs = this.state.known_jobs.filter((name) => this.shouldShowJob(name));
    const visible_jobs_head = visible_jobs.map((jobName) =>
      <th className="rotate" key={jobName} width="20px;"><div>{jobName}</div></th>);
    const benchmark_index = this.state.benchmark_index;
    
    const rows = builds.map((build) => {
      const sb_map = build.sb_map;
      const pytorch_version = build.sb_map.get("machine_info")["pytorch_version"];
      const status_cols = visible_jobs.map((jobName) => {
        const sb = sb_map.get("benchmarks")[benchmark_index.get(jobName)];
        const colkey = pytorch_version + "-" + jobName;
        let cell = <Fragment />;
        const prev_delta = (sb["stats"]["mean"] - sb["stats"]["prev_mean"]) / sb["stats"]["prev_mean"];
        if (sb !== undefined) {
          cell = <a href="#" className="icon" alt={jobName}>
                    {result_icon(prev_delta)}
                 </a>;
        }
        return <Tooltip
          key={jobName}
          overlay={jobName + " Mean: " + round_float(sb["stats"]["mean"])
                   + ", prev mean: " + round_float(sb["stats"]["prev_mean"])
                   + ", delta: " + gen_summary(prev_delta)}
          mouseLeaveDelay={0}
          placement="rightTop"
          destroyTooltipOnHide={true}>
          <td key={colkey} className="icon-cell" style={{textAlign: "right", fontFamily: "sans-serif", padding: 0}}> {cell} </td></Tooltip>;
      });

      return (
        <tr key={pytorch_version}>
          <th className="left-cell"> torch-{pytorch_version} </th>
          {status_cols}
        </tr>
      );
    });
    return (
      <div>
        <h2>TorchBench v0 nightly testing result</h2>
        <div>
          <ul className="menu">
         </ul>
        </div>
        <table className="perfHistoryTable">
          <thead>
            <tr>
              <th className="left-cell">Build</th>
              {visible_jobs_head}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  }
}

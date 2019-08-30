import React, { Component, Fragment } from 'react';
import jenkins from './Jenkins.js';
import AsOf from './AsOf.js';
import { summarize_job, summarize_date, centsToDollars, centsPerHour } from './Summarize.js';
import * as d3 from 'd3v4';
import parse_duration from 'parse-duration';
import Tooltip from 'rc-tooltip';

var binary_and_smoke_tests_on_pr = [
  "binary_linux_manywheel_2_7mu_cpu_devtoolset7_build",
  "binary_linux_manywheel_3_7m_cu100_devtoolset7_build",
  "binary_linux_conda_2_7_cpu_devtoolset7_build",
  "binary_macos_wheel_3_6_cpu_build",
  "binary_macos_conda_2_7_cpu_build",
  "binary_macos_libtorch_2_7_cpu_build",
  "binary_linux_manywheel_2_7mu_cpu_devtoolset7_test",
  "binary_linux_manywheel_3_7m_cu100_devtoolset7_test",
  "binary_linux_conda_2_7_cpu_devtoolset7_test",
  "binary_linux_libtorch_2_7m_cpu_devtoolset7_shared-with-deps_build",
  "binary_linux_libtorch_2_7m_cpu_devtoolset7_shared-with-deps_test",
  "binary_linux_libtorch_2_7m_cpu_gcc5_4_cxx11-abi_shared-with-deps_build",
  "binary_linux_libtorch_2_7m_cpu_gcc5_4_cxx11-abi_shared-with-deps_test"
];

// TODO: checks also supports neutral and action_required

function is_success(result) {
  return result === 'SUCCESS' || result === 'success';
}

function is_failure(result) {
  // TODO: maybe classify timeout differently
  return result === 'FAILURE' || result === 'failure' || result === 'error' || result === 'timed_out';
}

function is_aborted(result) {
  return result === 'ABORTED' || result == 'cancelled';
}

function is_pending(result) {
  return !result || result === 'pending';
}

function getJobName(subBuild) {
  const baseJobName = subBuild.jobName;
  if (/caffe2-builds/.test(subBuild.url)) {
    return 'caffe2-' + baseJobName;
  } else {
    return baseJobName;
  }
}

function classify_job_to_node(j) {
  if (j === 'short-perf-test-gpu') {
    return 'linux-gpu';
  } else if (j === 'doc-push') {
    return 'linux-cpu';
  } else if (/-win/.test(j)) {
    if (/-test/.test(j) && /-cuda/.test(j)) {
      return 'win-gpu';
    } else {
      return 'win-cpu';
    }
  } else if (/-macos/.test(j)) {
    return 'osx';
  } else if (/-linux/.test(j) || /-ubuntu/.test(j) || /-centos/.test(j) || /-xenial/.test(j)) {
    if (/cuda/.test(j)) {
      if (/-multigpu-test/.test(j)) {
        return 'linux-multigpu';
      } else if (/-test/.test(j)) {
        return 'linux-gpu';
      } else {
        return 'linux-cpu';
      }
    } else if (/-rocm/.test(j)) {
      if (/-test/.test(j)) {
        return 'rocm';
      } else {
        return 'linux-bigcpu';
      }
    } else {
      return 'linux-cpu';
    }
  }
  return 'unknown';
}

// Ideas:
//  - Put the master and pull request info together, so you can see what
//  the reported 'master' status is for a given 'pull-request' build

export default class BuildHistoryDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = this.initialState();
  }
  initialState() {
    const prefs_str = localStorage.getItem("prefs");
    let prefs = {};
    if (prefs_str) {
      prefs = JSON.parse(prefs_str);
    }
    if (!("showStale" in prefs)) prefs["showStale"] = false;
    if (!("username" in prefs)) prefs["username"] = "";
    if (!("showNotifications" in prefs)) prefs["showNotifications"] = true;
    return {
      builds: [],
      known_jobs: [],
      currentTime: new Date(),
      updateTime: new Date(0),
      showStale: prefs.showStale,
      username: prefs.username,
      showNotifications: prefs.showNotifications
    };
  }
  componentDidMount() {
    this.update();
    this.interval = setInterval(this.update.bind(this), this.props.interval);
    if (this.state.showNotifications && Notification.permission !== "granted") {
      Notification.requestPermission();
    }
  }
  componentDidUpdate(prevProps) {
    localStorage.setItem("prefs", JSON.stringify({
      showNotifications: this.state.showNotifications,
      showStale: this.state.showStale,
      username: this.state.username
    }));
    if (this.props.job !== prevProps.job) {
      this.setState(this.initialState());
      this.update();
    }
  }
  async update() {
    const currentTime = new Date();
    this.setState({currentTime: currentTime});
    // NB: server-slide slicing doesn't really help, Jenkins seems to
    // load everything into memory anyway
    let data;
    if (true) {
      // STOP.  You want more results?  You may have noticed that on
      // Google, people suggest using allBuilds with {0,n} to make use
      // of Jenkins pagination.  However, if you do this, it will *DOS our Jeenkins
      // instance*; even when pagination is requested, Jenkins will
      // still load ALL builds into memory before servicing your
      // request.  I've filed this at https://issues.jenkins-ci.org/browse/JENKINS-49908
      data = await jenkins.job(this.props.job,
        {tree: `builds[
                  url,
                  number,
                  duration,
                  timestamp,
                  result,
                  actions[parameters[name,value],
                  causes[shortDescription]],
                  changeSet[items[commitId,comment,msg]],
                  subBuilds[
                    result,jobName,url,duration,
                    build[
                      subBuilds[
                        result,jobName,url,duration,
                        build[
                          subBuilds[result,jobName,url,duration]
                        ]
                      ]
                    ]
                  ]
               ]`.replace(/\s+/g, '')});
               // build[builtOn]
    } else {
      // If you want entries in build on subBuilds, need depth = 3
      // Otherwise, most data can be got with depth = 1
      const depth = 1;
      data = await jenkins.job(this.props.job, {depth: depth});
    }
    data.updateTime = new Date();
    data.connectedIn = data.updateTime - currentTime;
    if (data.allBuilds !== undefined) {
      data.builds = data.allBuilds;
    }

    // Get build statuses from Github for CircleCI
    async function get_github_commit_statuses() {
      let github_commit_statuses = {}
      let requests = [];

      function add_jobs(jobs, index) {
        let commitId = requests[index].commitId;
        if (jobs) {
          for (let job_name in jobs) {
            let job = jobs[job_name];
            if (!(github_commit_statuses[commitId].hasOwnProperty(job_name))) {
              github_commit_statuses[commitId][job_name] = {"duration": "0", "result": job.status, "url": job.build_url};
            }
          };
        }
      }

      for (const commit of data.builds) {
        for (let i = 0; i < commit.changeSet.items.length; i++) {
          let commitId = commit.changeSet.items[i].commitId;
          if (!(github_commit_statuses.hasOwnProperty(commitId))) {
            github_commit_statuses[commitId] = {};
          }
          requests.push({
            url: "https://s3.amazonaws.com/ossci-job-status/combined/" + commitId + ".json",
            commitId
          });
        }

      }
      let results = await jenkins.batch_get(requests.map(request => request.url));
      results.forEach(add_jobs);
      return github_commit_statuses;
    }
    data.github_commit_statuses = await get_github_commit_statuses();

    const known_jobs_set = new Set();
    function collect_known_jobs_set(topBuild) {
      function go(subBuild) {
        if (subBuild.build && subBuild.build._class === "com.tikal.jenkins.plugins.multijob.MultiJobBuild") {
          subBuild.build.subBuilds.forEach(go);
        } else {
          known_jobs_set.add(getJobName(subBuild));
        }
      }
      topBuild.subBuilds.forEach(go);
    }
    const props_mode = this.props.mode;
    if (props_mode !== "binary") {
      data.builds.forEach(collect_known_jobs_set);
    }

    if (data.github_commit_statuses) {
      Object.keys(data.github_commit_statuses).forEach(function(commit) {
        var jobs = data.github_commit_statuses[commit];
        Object.keys(jobs).forEach(function(job_name) {
          if (props_mode !== "binary") {
            // Warning: quadratic police!
            for (var i = 0; i < binary_and_smoke_tests_on_pr.length; i++) {
              if (job_name.endsWith(binary_and_smoke_tests_on_pr[i])) {
                known_jobs_set.add("_" + job_name);  // Add "_" before name to make sure CircleCI builds always show up on the left
                break;
              }
            }
            if (!(job_name.includes("binary_") || job_name.includes("smoke_"))) {  // Exclude binary builds and smoke tests that are not running on every PR
              known_jobs_set.add("_" + job_name);  // Add "_" before name to make sure CircleCI builds always show up on the left
            }
          } else {
            if (job_name.includes("binary_") || job_name.includes("smoke_")) {
              let found = false;
              for (let i = 0; i < binary_and_smoke_tests_on_pr.length; i++) {
                if (job_name.endsWith(binary_and_smoke_tests_on_pr[i])) {
                  found = true;
                  break;
                }
              }
              if (!found) known_jobs_set.add("_" + job_name);
            }
          }
        });
      });
    }

    data.known_jobs = [...known_jobs_set.values()].sort();

    data.builds.forEach((build) => {
      const sb_map = new Map();

      // Collect job status from Jenkins
      function collect_jobs(topBuild) {
        function go(subBuild) {
          if (subBuild.build && subBuild.build._class === "com.tikal.jenkins.plugins.multijob.MultiJobBuild") {
            subBuild.build.subBuilds.forEach(go);
          } else {
            sb_map.set(getJobName(subBuild), subBuild);
          }
        }
        topBuild.subBuilds.forEach(go);
      }
      collect_jobs(build);

      // Collect job status for non-Jenkins jobs (i.e. CircleCI jobs)
      async function collect_jobs_from_github_status(build) {
        if (build.changeSet.items.length > 0) {
          for (var i = 0; i < build.changeSet.items.length; i++) {
            let commitId = build.changeSet.items[i].commitId;
            if (data.github_commit_statuses) {
              Object.keys(data.github_commit_statuses[commitId]).forEach(function(job_name) {
                var job = data.github_commit_statuses[commitId][job_name];
                sb_map.set("_" + job_name, {"duration": job.duration, "result": job.result, "url": job.url});
              });
            }
          }
        }
      }
      collect_jobs_from_github_status(build);
      build.sb_map = sb_map;
    });

    // Figure out if we think something is broken or not.
    //  1. Consider the MOST RECENT finished build for any given sub
    //     build type.  If it is success, it's fine.
    //  2. Otherwise, check builds prior to it.  If the previous build
    //     also failed, we think it's broken!
    //
    // Special cases:
    //  - pytorch_doc_push: don't care about this
    //  - nightlies: these don't run all the time

    const failure_window = 10;
    if (this.props.job.includes("master")) {
      const still_unknown_set = new Set();
      const consecutive_failure_count = new Map();
      data.known_jobs.forEach((job) => {
        if (job === "pytorch_doc_push") return;
        if (job === "__dr.ci") return;
        if (job.includes("nightlies")) return;
        still_unknown_set.add(job);
      });
      for (let i = 0; i < data.builds.length; i++) {
        // After some window, don't look anymore; the job may have been
        // removed
        if (i > failure_window) break;
        if (!still_unknown_set.size) break;
        const build = data.builds[i];
        const sb_map = build.sb_map;
        sb_map.forEach((sb, jobName) => {
          if (!still_unknown_set.has(jobName)) {
            // do nothing
          } else if (is_failure(sb.result)) {
            let count = consecutive_failure_count.get(jobName) || 0;
            count++;
            consecutive_failure_count.set(jobName, count);
          } else if (is_success(sb.result)) {
            still_unknown_set.delete(jobName);
          }
        });
      }

      // Prune uninteresting alarms
      consecutive_failure_count.forEach((v, k) => {
        // Require two consecutive failure to alert
        if (v <= 1) {
          consecutive_failure_count.delete(k);
        }
      });

      data.consecutive_failure_count = consecutive_failure_count;

      // Compute what notifications to show
      // We'll take a diff and then give notifications for keys that
      // changed
      if (this.state.consecutive_failure_count) {
        this.state.consecutive_failure_count.forEach((v, key) => {
          if (!consecutive_failure_count.has(key)) {
            // It's fixed!
            new Notification("✅ " + this.props.job, {"body": summarize_job(key), "requireInteraction": true});
          }
        });
      }
      consecutive_failure_count.forEach((v, key) => {
        // Don't produce notifications for initial failure!
        if (this.state.consecutive_failure_count && !this.state.consecutive_failure_count.has(key)) {
          // It's failed!
          new Notification("❌ " + this.props.job, {"body": summarize_job(key), "requireInteraction": true});
        }
      });
    }

    // TODO: This can cause spurious state updates
    this.setState(data);
  }

  render() {
    function result_icon(result) {
      if (is_success(result)) return <span role="img" style={{color:"green"}} aria-label="passed">0</span>;
      if (is_failure(result)) return <span role="img" style={{color:"red"}} aria-label="failed">X</span>;
      if (is_aborted(result)) return <span role="img" style={{color:"gray"}} aria-label="cancelled">.</span>;
      if (is_pending(result)) return <span className="animate-flicker" role="img" style={{color:"goldenrod"}} aria-label="in progress">?</span>;
      return result;
    }

    // Sigh... the place where you can get the information you're
    // interested in at the top level is NOT the same as where you get
    // it inside, because of how Jenkins handles depth (Jenkins
    // *will* give you information for everything recursively, just
    // not in the place you might expect it.
    //
    //  class: "com.tikal.jenkins.plugins.multijob.MultiJobBuild"
    //  id: "3772"
    //  subBuilds:
    //    0:
    //      jobName: "whatever"
    //      build:
    //        class: "com.tikal.jenkins.plugins.multijob.MultiJobBuild"
    //        subBuilds:

    let builds = this.state.builds;
    let consecutive_failure_count = this.state.consecutive_failure_count;

    const known_jobs = this.state.known_jobs;
    const known_jobs_head = known_jobs.map((jobName) =>
      <th className="rotate" key={jobName}><div className={consecutive_failure_count.has(jobName) ? "failing-header" : ""}>{summarize_job(jobName)}</div></th>
    );
    // const known_jobs_head = known_jobs.map((jobName) =>
    //  <th key={jobName}></th>
    //);

    const durationWidth = 100;
    const durationHeight = 10;
    const durationScale = d3.scaleLinear().rangeRound([0, durationWidth]);
    durationScale.domain([0, d3.max(builds, (b) => b.duration)]);

    const seen_prs = new Set();

    const rows = builds.map((build) => {
      const sb_map = build.sb_map;

      function perf_report(sb, result) {
        return <Fragment><span className={is_success(result) ? 'ok-duration' : 'suspect-duration'}>{parse_duration(sb.duration)/1000}</span>&nbsp;&nbsp;</Fragment>;
      }

      // let cumulativeMs = 0;
      let cost = 0;
      let unknownCost = false;
      let inProgressCost = false;
      let found = false;

      const status_cols = known_jobs.map((jobName) => {
        const sb = sb_map.get(jobName);
        let cell = <Fragment />;
        if (sb !== undefined) {
          found = true;
          const dur = parse_duration(sb.duration);
          // cumulativeMs += dur;
          const node = classify_job_to_node(getJobName(sb));
          let this_cost = 0;
          if (node === 'unknown') {
            unknownCost = true;
          } else {
            this_cost = Math.ceil(centsPerHour[node] * dur / 1000 / 60 / 60);
          }
          cost += this_cost;
          if (!sb.result) inProgressCost = true;
          if (this.props.mode === "perf") {
            cell = perf_report(sb, sb.result);
          } else if (this.props.mode === "cost") {
            cell = <Fragment>{node === 'unknown' ? '?' : this_cost}&nbsp;&nbsp;</Fragment>;
          } else {
            cell = <a href={/^https?:\/\//.test(sb.url) ? sb.url + "/console" : jenkins.link(sb.url + "/console")}
                      className="icon"
                      target="_blank"
                      alt={getJobName(sb)}>
                     {result_icon(sb.result)}
                   </a>;
          }
        }
        return <Tooltip
                      key={jobName}
                      overlay={jobName}
                      mouseLeaveDelay={0}
                      placement="rightTop"
                      destroyTooltipOnHide={true}><td key={jobName} className="icon-cell" style={{textAlign: "right", fontFamily: "sans-serif", padding: 0}}>{cell}</td></Tooltip>;
      });

      function drop_pr_number(msg) {
        return msg.replace(/\(#[0-9]+\)/, '');
      }

      function renderPullRequestNumber(comment) {
        let m = comment.match(/\(#(\d+)\)/);
        if (m) {
          return <Fragment><a href={"https://github.com/pytorch/pytorch/pull/" + m[1]} target="_blank">#{m[1]}</a></Fragment>;
        }
        return <Fragment />;
      }

      function renderCommit(commit) {
        return (
          <div key={commit.commitId}>
            {renderPullRequestNumber(commit.comment)} {drop_pr_number(commit.msg)}{' '}
            <code><a href={"https://github.com/pytorch/pytorch/commit/" + commit.commitId}
                     target="_blank">{commit.commitId.slice(0, 7)}</a></code>
          </div>
          );
      }

      function renderCauses(changeSet) {
        const defaultCause = <em>Manually triggered rebuild.</em>;
        if (changeSet.actions === undefined) return defaultCause;
        return changeSet.actions
          .filter((action) => action.causes !== undefined)
          .map((action, i) =>
            action.causes.map((cause, i) => <em key={i}>{cause.shortDescription}.{" "}</em>));
      }

      function getPushedBy(build) {
        const action = build.actions.find((action) => action._class === "hudson.model.CauseAction");
        if (action === undefined) return "(unknown)";
        const cause = action.causes.find((cause) => cause._class === "com.cloudbees.jenkins.GitHubPushCause");
        if (cause === undefined) return "";
        const match = cause.shortDescription.match(/Started by GitHub push by (.+)/);
        if (match === null) return cause.shortDescription;
        return match[1];
      }

      function getPullParams(build) {
        let action = build.actions.find((action) => action._class === "org.jenkinsci.plugins.ghprb.GhprbParametersAction");
        if (action === undefined) {
          action = build.actions.find((action) => action._class === "com.tikal.jenkins.plugins.multijob.MultiJobParametersAction");
        }
        if (action === undefined) {
          return new Map();
        }
        return new Map(action.parameters.map((param) => [param.name, param.value]));
      }

      const isRebuild = build.actions.some(
        (action) => action.causes !== undefined &&
                    action.causes.some(
                      (cause) => cause._class === "com.sonyericsson.rebuild.RebuildCause"
                    ));
      const isPullRequest = build.actions.some(
        (action) => action.causes !== undefined &&
                    action.causes.some(
                      (cause) => cause._class === "org.jenkinsci.plugins.ghprb.GhprbCause" ||
                                 (cause._class === "hudson.model.Cause$UpstreamCause" && /-pull-request$/.test(cause.upstreamProject))
                    ))

      let author = "";
      let desc = "";
      let pull_link;
      let pull_id;

      // TODO: Too lazy to set up PR numbers for the old ones

      let stale = false;
      if (isRebuild) {
        desc = renderCauses(build);
      } else if (isPullRequest) {
        const params = getPullParams(build);
        const title = params.get("ghprbPullTitle");
        pull_link = params.get("ghprbPullLink");
        pull_id = params.get("ghprbPullId");
        author = params.get("ghprbPullAuthorLogin");
        desc = title;
        if (seen_prs.has(pull_id)) {
          // TODO: do this filtering earlier
          if (!this.state.showStale) return <Fragment key={build.number} />;
          stale = true;
        }
        if (this.state.username !== "" && this.state.username !== author) {
          return <Fragment key={build.number} />;
        }
        seen_prs.add(pull_id);
      } else {
        const changeSet = build.changeSet;
        // TODO: This is empty for not pytorch-master.  We could
        // probably get the info if we propagate it as a variable.
        author = getPushedBy(build);
        if (changeSet.items.length === 0) {
          desc = renderCauses(build);
        } else {
          desc = changeSet.items.slice().reverse().map(renderCommit);
        }
      }

      const whenString = summarize_date(build.timestamp);

      if (!found) {
        return <Fragment />
      }

      return (
        <tr key={build.number} className={stale ? "stale" : ""}>
          <th className="left-cell"><a href={build.url} target="_blank">{build.number}</a></th>
          <th className="left-cell"><a href={pull_link} target="_blank">{pull_id ? "#" + pull_id : ""}</a></th>
          <td className="left-cell">{whenString}</td>
          {status_cols}
          <td className="right-cell bar-number">{Math.floor(build.duration/1000/60)}</td>
          <td>
            <svg width={durationWidth} height={durationHeight}>
              <rect className="bar"
                    x="0"
                    y="0"
                    width={durationScale(build.duration)}
                    height={durationHeight} />
            </svg>
          </td>
          <td className="right-cell" style={{textAlign: "right"}}>{inProgressCost ? "≥ " : ""}{centsToDollars(cost)}{unknownCost ? "?" : ""}</td>
          <td className="right-cell">{author}</td>
          <td className="right-cell">{desc}</td>
        </tr>
        );
    });

    return (
      <div>
        <h2>
          <a href={jenkins.link("job/" + this.props.job)} target="_blank">{this.props.job}</a> history{' '}
          <AsOf interval={this.props.interval}
                connectedIn={this.state.connectedIn}
                currentTime={this.state.currentTime}
                updateTime={this.state.updateTime} />
        </h2>
        <div>
          <ul className="menu">
            <li>
              <input type="checkbox" name="show-stale" checked={this.state.showStale} onChange={(e) => { this.setState({showStale: e.target.checked}) }} />
              <label htmlFor="show-stale">Show stale builds of PRs</label>
            </li>
            <li>
              <input type="text" name="username" value={this.state.username} onChange={(e) => { this.setState({username: e.target.value}) }} />
              <label htmlFor="username" style={{backgroundColor: "white", position: "relative", zIndex: 3}}>Show builds from this user only</label>
            </li>
            <li>
              <input type="checkbox" name="show-notifications" checked={this.state.showNotifications} onChange={(e) => this.setState({showNotifications: e.target.checked}) } />
              <label htmlFor="show-notifications">Show notifications on master failure
                { Notification.permission === "denied" ? <Fragment> <strong>(WARNING: notifications are currently denied)</strong></Fragment> : "" }
              </label>
            </li>
          </ul>
        </div>
        <table className="buildHistoryTable">
          <thead>
            <tr>
              <th className="left-cell">J#</th>
              <th className="left-cell">PR#</th>
              <th className="left-cell">Date</th>
              {known_jobs_head}
              <th className="right-cell" colSpan="2">Latency (min)</th>
              <th className="right-cell">Cost</th>
              <th className="right-cell">User</th>
              <th className="right-cell">Description</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    );
  }
}


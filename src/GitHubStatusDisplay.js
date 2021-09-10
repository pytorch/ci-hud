// Copyright (c) Facebook, Inc. and its affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

import React, { Component, Fragment } from "react";
import jenkins from "./Jenkins.js";
import AsOf from "./AsOf.js";
import { summarize_job, summarize_date } from "./Summarize.js";
import Tooltip from "rc-tooltip";
import axios from "axios";
import {
  BsFillCaretRightFill,
  BsFillCaretDownFill,
  ImSpinner2,
} from "react-icons/all";

function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

function array_move(arr, old_index, new_index) {
  while (old_index < 0) {
    old_index += arr.length;
  }
  while (new_index < 0) {
    new_index += arr.length;
  }
  if (new_index >= arr.length) {
    var k = new_index - arr.length + 1;
    while (k--) {
      arr.push(undefined);
    }
  }
  arr.splice(new_index, 0, arr.splice(old_index, 1)[0]);
}

function is_success(result) {
  return result === "SUCCESS" || result === "success";
}

function is_failure(result) {
  // TODO: maybe classify timeout differently
  return (
    result === "FAILURE" ||
    result === "failure" ||
    result === "error" ||
    result === "timed_out"
  );
}

function is_aborted(result) {
  return result === "ABORTED" || result === "cancelled";
}

function is_pending(result) {
  return !result || result === "pending";
}

function is_skipped(result) {
  return result === "skipped";
}

function is_infra_failure(result) {
  return result === "infrastructure_fail";
}

function objToStrMap(obj) {
  let strMap = new Map();
  for (let k of Object.keys(obj)) {
    strMap.set(k, obj[k]);
  }
  return strMap;
}

function computeConsecutiveFailureCount(data, failure_window = 10) {
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
      } else if (is_failure(sb.status)) {
        let count = consecutive_failure_count.get(jobName) || 0;
        count++;
        consecutive_failure_count.set(jobName, count);
      } else if (is_success(sb.status)) {
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
  return consecutive_failure_count;
}

function getJenkinsJobName(subBuild) {
  const baseJobName = subBuild.jobName;
  if (/caffe2-builds/.test(subBuild.url)) {
    return "jenkins: caffe2-" + baseJobName;
  } else {
    return "jenkins: " + baseJobName;
  }
}

export default class BuildHistoryDisplay extends Component {
  constructor(props) {
    super(props);
    this.state = this.initialState();
  }
  initialState() {
    const prefs_str = localStorage.getItem("prefs2");
    let prefs = {};
    if (prefs_str) {
      prefs = JSON.parse(prefs_str);
    }
    if (!("showNotifications" in prefs))
      prefs["showNotifications"] = !isMobile();
    if (!("groupJobs" in prefs)) prefs["groupJobs"] = true;
    return {
      builds: [],
      known_jobs: [],
      showGroups: [],
      currentTime: new Date(),
      updateTime: new Date(0),
      showNotifications: prefs.showNotifications,
      groupJobs: prefs.groupJobs,
      jobNameFilter: "",
    };
  }
  componentDidMount() {
    this.update();
    this.interval = setInterval(this.update.bind(this), this.props.interval);
    if (
      !isMobile() &&
      this.state.showNotifications &&
      Notification.permission !== "granted"
    ) {
      Notification.requestPermission();
    }
  }
  componentDidUpdate(prevProps) {
    localStorage.setItem(
      "prefs2",
      JSON.stringify({
        showNotifications: this.state.showNotifications,
        groupJobs: this.state.groupJobs,
      })
    );
    if (this.props.job !== prevProps.job) {
      this.setState(this.initialState());
      this.update();
    }
  }
  async addJenkinsResults(builds) {
    // Adds Jenkins results to builds array
    // Step 1. Fetch info via GraphQL
    //
    // STOP.  You want more results?  You may have noticed that on
    // Google, people suggest using allBuilds with {0,n} to make use
    // of Jenkins pagination.  However, if you do this, it will *DOS our Jeenkins
    // instance*; even when pagination is requested, Jenkins will
    // still load ALL builds into memory before servicing your
    // request.  I've filed this at https://issues.jenkins-ci.org/browse/JENKINS-49908
    let jenkins_data = await jenkins.job(this.props.job, {
      tree: `builds[
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
             ]`.replace(/\s+/g, ""),
    });

    // Step 2: Build commit to build idx map
    const commitIdxMap = new Map();
    builds.forEach((build, idx) => {
      commitIdxMap[build.id] = idx;
    });

    // Step 3: Add jenkins jobs
    if (jenkins_data) {
      jenkins_data.builds.forEach((topBuild) => {
        if (topBuild.changeSet.items.length !== 1) {
          return;
        }
        const buildCommitId = topBuild.changeSet.items[0].commitId;
        if (!(buildCommitId in commitIdxMap)) {
          return;
        }
        const buildIdx = commitIdxMap[buildCommitId];
        function go(subBuild) {
          if (
            subBuild.build &&
            subBuild.build._class ===
              "com.tikal.jenkins.plugins.multijob.MultiJobBuild"
          ) {
            subBuild.build.subBuilds.forEach(go);
          } else {
            builds[buildIdx].sb_map.set(
              getJenkinsJobName(subBuild),
              Object.fromEntries([
                ["status", subBuild.result],
                ["build_url", jenkins.link(subBuild.url + "/console")],
              ])
            );
          }
        }
        topBuild.subBuilds.forEach(go);
      });
    }
  }
  async update() {
    let content = await fetch(
      "https://ossci-job-status.s3.amazonaws.com/mysql_status_master.json.gz"
    );
    let x = await content.json();
    // console.log(content);
    // console.log(x);
    // return;
    this.setState({ allInOne: x });
    return;
    // return;
    const currentTime = new Date();
    const branch = this.props.job.replace(/^pytorch-/, "");
    const build_prefix = branch === "master" ? branch : "pr";
    const url_prefix = "https://s3.amazonaws.com/ossci-job-status";
    this.setState({ currentTime: currentTime });

    const commits = await axios.get(`${url_prefix}/${branch}/index.json`);

    const requests = commits.data.map(async (build) => {
      try {
        const r = await axios.get(
          `${url_prefix}/${build_prefix}/${build.id}.json`
        );
        build.sb_map = objToStrMap(r.data);
      } catch (e) {
        build.sb_map = new Map();
        // swallow
      }
      return build;
    });
    const builds = await axios.all(requests);
    builds.reverse();

    if (branch === "master") {
      await this.addJenkinsResults(builds);
    }

    const data = {};

    data.updateTime = new Date();
    data.connectedIn = data.updateTime - currentTime;

    const known_jobs_set = new Set();
    builds.forEach((build) => {
      build.sb_map.forEach((sb, job_name) => {
        known_jobs_set.add(job_name);
      });
    });

    data.known_jobs = [...known_jobs_set.values()].sort();
    data.builds = builds;

    // Figure out if we think something is broken or not.
    //  1. Consider the MOST RECENT finished build for any given sub
    //     build type.  If it is success, it's fine.
    //  2. Otherwise, check builds prior to it.  If the previous build
    //     also failed, we think it's broken!
    //
    // Special cases:
    //  - pytorch_doc_push: don't care about this
    //  - nightlies: these don't run all the time

    if (this.props.job.startsWith("pytorch-")) {
      data.consecutive_failure_count = computeConsecutiveFailureCount(data);

      // Compute what notifications to show
      // We'll take a diff and then give notifications for keys that
      // changed
      if (!isMobile()) {
        if (this.state.consecutive_failure_count) {
          this.state.consecutive_failure_count.forEach((v, key) => {
            if (!data.consecutive_failure_count.has(key)) {
              // It's fixed!
              new Notification("✅ " + this.props.job, {
                body: summarize_job(key),
              });
            }
          });
        }
        data.consecutive_failure_count.forEach((v, key) => {
          // Don't produce notifications for initial failure!
          if (
            this.state.consecutive_failure_count &&
            !this.state.consecutive_failure_count.has(key)
          ) {
            // It's failed!
            new Notification("❌ " + this.props.job, {
              body: summarize_job(key),
            });
          }
        });
      }
    }

    this.setState(data);
  }

  nameMatches(name, filter) {
    if (name.includes(filter)) {
      return true;
    }

    // try-catch this since filter is user supplied and RegExp errors on invalid
    // regexes
    try {
      const regex = new RegExp(filter);
      return Boolean(name.match(regex));
    } catch {
      return false;
    }
  }

  shouldShowJob(name) {
    const jobNameFilter = this.state.jobNameFilter;
    if (jobNameFilter.length > 0 && !this.nameMatches(name, jobNameFilter)) {
      return false;
    }
    const isDockerJob = name.startsWith("ci/circleci: docker");
    const isGCJob = name.startsWith("ci/circleci: ecr_gc");
    const isCIFlowShouldRunJob = name.endsWith("ciflow_should_run");
    return !(
      isDockerJob ||
      name === "welcome" ||
      isGCJob ||
      isCIFlowShouldRunJob
    );
  }

  render() {
    let groups = [
      {
        regex: /Lint/,
        name: "Lint Jobs",
      },
      {
        regex:
          /(\(periodic-pytorch)|(ci\/circleci: periodic_pytorch)|(^periodic-)/,
        name: "Periodic Jobs",
      },
      {
        regex: /(Linux CI \(pytorch-linux-)|(^linux-)/,
        name: "Linux GitHub Actions",
      },
      {
        regex:
          /(Add annotations )|(Close stale pull requests)|(Label PRs & Issues)|(Triage )|(Update S3 HTML indices)|(codecov\/project)|(Facebook CLA Check)|(auto-label-rocm)/,
        name: "Annotations and labeling",
      },
      {
        regex:
          /(ci\/circleci: docker-pytorch-)|(ci\/circleci: ecr_gc_job_)|(ci\/circleci: docker_for_ecr_gc_build_job)|(Garbage Collect ECR Images)/,
        name: "Docker",
      },
      {
        regex: /(Windows CI \(pytorch-)|(^win-)/,
        name: "Windows GitHub Actions",
      },
      {
        regex: / \/ calculate-docker-image/,
        name: "GitHub calculate-docker-image",
      },
      {
        regex: /ci\/circleci: pytorch_ios_/,
        name: "ci/circleci: pytorch_ios",
      },
      {
        regex:
          /(ci\/circleci: pytorch_parallelnative_)|(ci\/circleci: pytorch_paralleltbb_)|(paralleltbb-linux-)|(parallelnative-linux-)/,
        name: "Parallel",
      },
      {
        regex:
          /(ci\/circleci: pytorch_cpp_doc_build)|(ci\/circleci: pytorch_cpp_doc_test)|(pytorch_python_doc_build)|(pytorch_doc_test)/,
        name: "Docs",
      },
      {
        regex: /ci\/circleci: pytorch_linux_bionic_cuda10_2_cudnn7_py3_9_gcc7_/,
        name: "ci/circleci: pytorch_linux_bionic_cuda10_2_cudnn7_py3_9_gcc7",
      },
      {
        regex: /ci\/circleci: pytorch_linux_xenial_cuda10_2_cudnn7_py3_/,
        name: "ci/circleci: pytorch_linux_xenial_cuda10_2_cudnn7_py3",
      },
      {
        regex: /ci\/circleci: pytorch_linux_xenial_cuda11_1_cudnn8_py3_gcc7_/,
        name: "ci/circleci: pytorch_linux_xenial_cuda11_1_cudnn8_py3_gcc7",
      },
      {
        regex:
          /(ci\/circleci: pytorch_linux_xenial_py3_clang5_android_ndk_r19c_)|(ci\/circleci: pytorch-linux-xenial-py3-clang5-android-ndk-r19c-)/,
        name: "ci/circleci: pytorch_linux_xenial_py3_clang5_android_ndk",
      },
      {
        regex: /ci\/circleci: pytorch_linux_xenial_py3_6_gcc7_build/,
        name: "ci/circleci: pytorch_linux_xenial_py3_clang5_asan_build",
      },
      {
        regex: /ci\/circleci: pytorch_linux_xenial_py3_clang5_mobile_/,
        name: "ci/circleci: pytorch_linux_xenial_py3_clang5_mobile",
      },
      {
        regex: /ci\/circleci: pytorch_linux_xenial_py3_clang7_onnx_/,
        name: "ci/circleci: pytorch_linux_xenial_py3_clang7_onnx",
      },
      {
        regex: /ci\/circleci: pytorch_linux_xenial_py3_clang5_asan_/,
        name: "ci/circleci: pytorch_linux_xenial_py3_clang5_asan",
      },
      {
        regex: /ci\/circleci: pytorch_linux_xenial_py3_6_gcc7_/,
        name: "ci/circleci: pytorch_linux_xenial_py3_6_gcc7",
      },
      {
        regex: /ci\/circleci: pytorch_macos_10_13_py3_/,
        name: "ci/circleci: pytorch_macos_10_13_py3",
      },
      {
        regex: /ci\/circleci: pytorch_linux_xenial_py3_6_gcc5_4_/,
        name: "ci/circleci: pytorch_linux_xenial_py3_6_gcc5_4",
      },
      {
        regex: /ci\/circleci: binary_linux_/,
        name: "ci/circleci: binary_linux",
      },
      {
        regex: /ci\/circleci: binary_macos_/,
        name: "ci/circleci: binary_macos",
      },
      {
        regex: /ci\/circleci: binary_windows_/,
        name: "ci/circleci: binary_windows",
      },
      {
        regex: /(pytorch-linux-bionic-rocm)|(pytorch_linux_bionic_rocm)/,
        name: "ROCm",
      },
    ];

    if (!this.state.allInOne) {
      return <p>Loading</p>;
    }
    console.log(this.state.allInOne);
    const commits = this.state.allInOne;
    let headers = Object.keys(commits[0].jobs);
    headers = headers.sort();
    let headersTds = [
      <td>pr</td>,
      <td>commit time</td>,
    ];
    for (const header of headers) {
      headersTds.push(<th className="rotate"><div>{header}</div></th>);
    }
    headersTds.push(<td>commit author</td>);
    headersTds.push(<td>commit message</td>);
    headersTds.push(<td>commit hash</td>);

    let rowsTds = [];
    for (const commit of commits) {
      let cells = [];
      cells.push(<td>#{commit.pr}</td>);
      cells.push(<td>{commit.head_commit_timestamp}</td>);

      for (const header of headers) {
        let job = commit.jobs[header];
        if (!job) {
          cells.push(<td></td>);
        } else {
          cells.push(<td><a href={commit.jobs[header][1]}>{result_icon(commit.jobs[header][0])}</a></td>);
        }
      }

      cells.push(<td>{commit.head_commit_author_username}</td>);
      cells.push(<td>{commit.head_commit_title}</td>);
      cells.push(<td>{commit.head_commit_id}</td>);


      rowsTds.push(<tr>{cells}</tr>);
    }
    return (
      <table className="buildHistoryTable">
        <thead>
          <tr>{headersTds}</tr>
        </thead>
        <tbody>
          {rowsTds}
        </tbody>
      </table>
    );

    // Initialize the groups
    for (const group of groups) {
      group.jobNames = [];
    }

    if (!this.state.groupJobs) {
      groups = [];
    }

    const findGroup = (jobName) => {
      for (const group of groups) {
        if (jobName.match(group.regex)) {
          return group;
        }
      }
      return null;
    };

    const groupIsExpanded = (group) => {
      for (const stateGroup of this.state.showGroups) {
        if (stateGroup.name === group.name) {
          return true;
        }
      }
      return false;
    };

    const groupIsFailing = (group) => {
      for (const jobName of group.jobNames) {
        if (this.state.consecutive_failure_count.has(jobName)) {
          return true;
        }
      }

      return false;
    };

    function result_icon(result) {
      if (is_success(result))
        return (
          <span role="img" style={{ color: "green" }} aria-label="passed">
            0
          </span>
        );
      if (is_skipped(result))
        return (
          <span role="img" style={{ color: "gray" }} aria-label="skipped">
            S
          </span>
        );
      if (is_failure(result))
        return (
          <span role="img" style={{ color: "red" }} aria-label="failed">
            X
          </span>
        );
      if (is_aborted(result))
        return (
          <span role="img" style={{ color: "gray" }} aria-label="cancelled">
            .
          </span>
        );
      if (is_pending(result))
        return (
          <span
            className="animate-flicker"
            role="img"
            style={{ color: "goldenrod" }}
            aria-label="in progress"
          >
            ?
          </span>
        );
      if (is_infra_failure(result))
        return (
          <span role="img" style={{ color: "grey" }} aria-label="failed">
            X
          </span>
        );
      return result;
    }

    console.log(this.state.builds);
    console.log(this.state.consecutive_failure_count);
    console.log(this.state.known_jobs);
    let builds = this.state.builds;
    let consecutive_failure_count = this.state.consecutive_failure_count;

    const visibleJobs = this.state.known_jobs.filter((name) =>
      this.shouldShowJob(name)
    );
    let s = "";
    for (const j of visibleJobs) {
      s += j + "\n";
    }

    // Collapse down groups of jobs based on a regex match to the name
    const groupedVisibleJobsMap = {};
    for (const jobName of visibleJobs) {
      let group = findGroup(jobName);

      if (!group || groupIsExpanded(group)) {
        // Fake a group of size one
        group = {
          name: jobName,
          jobNames: [jobName],
        };
      } else {
        group.jobNames.push(jobName);
      }
      groupedVisibleJobsMap[group.name] = group;
    }

    // Go from the map of name -> group to a sorted list
    let groupedVisibleJobs = [];
    for (const groupName in groupedVisibleJobsMap) {
      groupedVisibleJobs.push({
        name: groupName,
        group: groupedVisibleJobsMap[groupName],
      });
    }

    for (const group of this.state.showGroups) {
      // Keep in headers for expanded groups
      groupedVisibleJobs.push({
        name: group.name,
        group: group,
      });
    }

    // Sort by group name
    groupedVisibleJobs.sort((a, b) => {
      if (a.name < b.name) {
        return -1;
      }
      if (a.name > b.name) {
        return 1;
      }
      return 0;
    });

    // Now that jobs have been globally sorted, shuffle around the expanded groups
    // so they show up next to their group header
    for (const group of this.state.showGroups) {
      let groupBaseIndex = groupedVisibleJobs.findIndex(
        (job) => job.name == group.name
      );
      if (groupBaseIndex === null) {
        console.error(`Unable to find group ${group.name}`);
        continue;
      }

      for (const jobName of group.jobNames) {
        let jobIndex = groupedVisibleJobs.findIndex(
          (job) => job.name == jobName
        );
        if (jobIndex === null) {
          console.error(`Unable to job ${jobName} in group ${group.name}`);
          continue;
        }
        if (jobIndex < groupBaseIndex) {
          array_move(groupedVisibleJobs, jobIndex, groupBaseIndex);
        } else {
          array_move(groupedVisibleJobs, jobIndex, groupBaseIndex + 1);
        }
      }
    }

    const toggleGroup = (group) => {
      let showGroups = this.state.showGroups;

      if (groupIsExpanded(group)) {
        // Remove the group
        showGroups.pop(
          showGroups.findIndex((shownGroup) => shownGroup.name === group.name)
        );
      } else {
        showGroups.push(group);
      }
      this.setState({ showGroups: showGroups });
    };

    const visibleJobsHeaders = [];
    for (const data of groupedVisibleJobs) {
      const jobName = data.name;
      let header = (
        <th className="rotate" key={jobName}>
          <div
            className={
              consecutive_failure_count.has(jobName) ? "failing-header" : ""
            }
          >
            {summarize_job(jobName)}
          </div>
        </th>
      );

      if (data.group.jobNames.length > 1) {
        const group = data.group;
        let icon = <BsFillCaretRightFill />;

        if (groupIsExpanded(group)) {
          icon = <BsFillCaretDownFill />;
        }

        let headerClass = "";
        if (groupIsFailing(group)) {
          headerClass = "failing-text";
        }

        header = (
          <th className="rotate" key={jobName}>
            <div
              onClick={() => {
                toggleGroup(group);
              }}
              style={{ cursor: "pointer" }}
            >
              <span style={{ color: "#d0d0d0" }}>Group </span>
              <span className={headerClass}>{group.name}</span> {icon}
            </div>
          </th>
        );
      }
      visibleJobsHeaders.push(header);
    }

    function aggregateStatus(jobs) {
      // The logic here follows these rules (in order):
      // 1. If there are no jobs, return no status
      // 2. Failed if any job is failed
      // 3. Pending if any job is pending
      // 4. Success if all jobs are success, skipped, or aborted
      // 5. Otherwise pending

      jobs = jobs.filter((x) => x !== undefined);
      if (jobs.length == 0) {
        // No jobs in the group so don't show anything
        return null;
      }

      for (const job of jobs) {
        if (is_failure(job.status) || is_infra_failure(job.status)) {
          return "failure";
        }
      }

      for (const job of jobs) {
        if (is_pending(job.status)) {
          return "pending";
        }
      }

      let allOk = true;
      for (const job of jobs) {
        if (
          !(
            is_success(job.status) ||
            is_skipped(job.status) ||
            is_aborted(job.status)
          )
        ) {
          allOk = false;
        }
      }
      if (allOk) {
        return "success";
      }

      return "pending";
    }

    const rows = builds.map((build) => {
      let found = false;
      const sb_map = build.sb_map;

      const status_cols = groupedVisibleJobs.map((data) => {
        let cell = <Fragment />;
        let jobName = data.name;

        if (data.group.jobNames.length > 1) {
          // For groups, get the status of all the jobs in the group
          jobName = `Group: ${data.group.name}`;
          const jobs = data.group.jobNames.map((jobName) =>
            sb_map.get(jobName)
          );
          const status = aggregateStatus(jobs);
          if (status) {
            cell = (
              <div
                className="display-cell"
                style={{
                  fontWeight: "bold",
                }}
                onClick={() => {
                  toggleGroup(data.group);
                }}
              >
                {result_icon(status)}
              </div>
            );
            found = true;
          }
        } else {
          // Ungrouped job, show it directly
          const sb = sb_map.get(jobName);
          if (sb !== undefined) {
            found = true;
            cell = (
              <div className="display-cell">
                <a
                  href={sb.build_url}
                  className="icon"
                  target="_blank"
                  alt={jobName}
                >
                  {result_icon(sb.status)}
                </a>
              </div>
            );
          }
        }

        return (
          <Tooltip
            key={jobName}
            overlay={jobName}
            mouseLeaveDelay={0}
            placement="rightTop"
            destroyTooltipOnHide={{ keepParent: false }}
          >
            <td key={jobName} className="icon-cell">
              {cell}
            </td>
          </Tooltip>
        );
      });

      function drop_pr_number(msg) {
        return msg.replace(/\(#[0-9]+\)/, "");
      }

      function renderPullRequestNumber(comment) {
        let m = comment.match(/\(#(\d+)\)/);
        if (m) {
          return (
            <Fragment>
              <a
                href={"https://github.com/pytorch/pytorch/pull/" + m[1]}
                target="_blank"
              >
                #{m[1]}
              </a>
            </Fragment>
          );
        }
        m = comment.match(
          /https:\/\/github.com\/pytorch\/pytorch\/pull\/(\d+)/
        );
        if (m) {
          return (
            <Fragment>
              <a
                href={"https://github.com/pytorch/pytorch/pull/" + m[1]}
                target="_blank"
              >
                #{m[1]}
              </a>
            </Fragment>
          );
        }
        return <Fragment />;
      }

      let author = build.author.username
        ? build.author.username
        : build.author.name;

      // Cut off author at arbitrary length
      if (author.length > 10) {
        author = `${author.slice(0, 10)}...`;
      }

      const desc = (
        <div key={build.id}>
          <a style={{ color: "#003d7f" }} href={`/commit/${build.id}`}>
            {drop_pr_number(build.message).split("\n")[0]}{" "}
          </a>
          <code>
            <a
              href={"https://github.com/pytorch/pytorch/commit/" + build.id}
              target="_blank"
            >
              {build.id.slice(0, 7)}
            </a>
          </code>
        </div>
      );

      // TODO: Too lazy to set up PR numbers for the old ones

      let stale = false;

      // TODO: need to store this in index or payload
      const whenString = summarize_date(build.timestamp);

      if (!found) {
        return <Fragment key={build.id} />;
      }

      return (
        <tr key={build.id} className={stale ? "stale" : ""}>
          <th className="left-cell">
            {renderPullRequestNumber(build.message)}
          </th>
          <td className="left-cell" title={build.timestamp}>
            {whenString}
          </td>
          {status_cols}
          <td className="right-cell">{author}</td>
          <td>{desc}</td>
        </tr>
      );
    });

    return (
      <div>
        <h2>{this.props.job} history </h2>
        <div>
          <ul className="menu">
            {isMobile() ? null : (
              <li>
                <input
                  type="checkbox"
                  name="show-notifications"
                  checked={this.state.showNotifications}
                  onChange={(e) =>
                    this.setState({ showNotifications: e.target.checked })
                  }
                />
                <label htmlFor="show-notifications">
                  Show notifications on master failure
                  {this.state.showNotifications &&
                  Notification &&
                  Notification.permission === "denied" ? (
                    <Fragment>
                      {" "}
                      <strong>
                        (WARNING: notifications are currently denied)
                      </strong>
                    </Fragment>
                  ) : (
                    ""
                  )}
                </label>
              </li>
            )}
            {isMobile() ? null : <br />}
            <li>
              <input
                type="checkbox"
                name="group-jobs"
                checked={this.state.groupJobs}
                onChange={(e) => this.setState({ groupJobs: e.target.checked })}
              />
              <label htmlFor="group-jobs">Group related jobs</label>
            </li>
            <li>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  let filter = document.getElementById("job-name-filter");
                  this.setState({ jobNameFilter: filter.value });
                }}
              >
                <label htmlFor="job-name-filter">Name filter:&nbsp;</label>
                <input
                  type="input"
                  name="job-name-filter"
                  id="job-name-filter"
                  value={this.jobNameFilter ? this.jobNameFilter : undefined}
                />
                <input style={{ marginLeft: "3px" }} type="submit" value="Go" />
              </form>
            </li>
          </ul>
        </div>
        <table className="buildHistoryTable">
          <thead>
            <tr>
              <th className="left-cell">PR#</th>
              <th className="left-cell">Date</th>
              {visibleJobsHeaders}
              <th className="right-cell">User</th>
              <th className="right-cell">Description</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
        {rows.length > 0 ? null : <ImSpinner2 className="icon-spin" />}
      </div>
    );
  }
}

import React from "react";
import { Link } from "react-router-dom";
import BranchLink from "./BranchLink";
import { getStatusUrl } from "../utils/GetStatusUrlUtils";
export default function ShowMoreLinkHeader() {
  const ExtraLibraries = () => {
    const libraries = {
      audio: { user: "pytorch", repo: "audio", branch: "main" },
      vision: { user: "pytorch", repo: "vision", branch: "main" },
      text: { user: "pytorch", repo: "text", branch: "main" },
      "pytorch-lightning": {
        user: "PyTorchLightning",
        repo: "pytorch-lightning",
        branch: "master",
      },
    };
    return (
      <ul className="menu">
        <li>Libraries:</li>
        {Object.keys(libraries).map((library, ind) => {
          const { user, repo, branch } = libraries[library];
          return (
            <li key={ind}>
              <BranchLink
                jsonUrl={getStatusUrl(user, repo, branch)}
                link={`/ci/${user}/${repo}/${branch}/`}
              >
                {library + " "}
              </BranchLink>
            </li>
          );
        })}
        <li>
          <Link to="/torchbench-v0-nightly">torchbench</Link>
        </li>
      </ul>
    );
  };

  const DeprecatedSection = () => {
    const libraries = {
      "pytorch-master": ["perf", "cost", "binary"],
      "pytorch-pull-request": ["perf", "cost"],
      // 'tensorcomp':[],
      // 'translate': [],
      "rocm-pytorch": ["perf", "cost"],
      "rocm-pytorch-pull-request": ["perf", "cost"],
    };

    const DeprecatedLinks = () => {
      const links = Object.keys(libraries).map((library, index) => {
        return (
          <React.Fragment key={index}>
            <Link to={"/build1/" + library}>{library}</Link>
            &nbsp;{"("}
            {libraries[library].map((mode, ind) => {
              return (
                <Link key={ind} to={"/build1/" + library + `?mode=${mode}`}>
                  {mode}
                  {ind !== libraries[library].length - 1 ? "/" : ""}
                </Link>
              );
            })}
            {")"}&nbsp;
          </React.Fragment>
        );
      });
      return links;
    };
    return (
      <ul className="deprecated-menu">
        <li>Old-style:</li>
        <DeprecatedLinks />
        <Link to={"/build1/nightlies-uploaded"}> nightlies-uploaded</Link>
      </ul>
    );
  };

  const Status = () => {
    return (
      <ul className="menu">
        <li>
          <Link to="/status">status</Link>
        </li>
      </ul>
    );
  };

  return (
    <div>
      <ExtraLibraries />
      <DeprecatedSection />
      <Status />
    </div>
  );
}

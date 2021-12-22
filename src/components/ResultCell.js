import React from "react";

export default function ResultCell({ url, jobName, children }) {
  return (
    <div className="display-cell">
      <a
        href={url}
        className="icon"
        target="_blank"
        alt={jobName}
        rel="noreferrer"
      >
        {children}
      </a>
    </div>
  );
}

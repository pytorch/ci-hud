export function summarize_job(job) {
  return job.replace(/^pytorch-/, '').replace(/-trigger$/, '');
}

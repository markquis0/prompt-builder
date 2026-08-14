import posthog from "posthog-js";
import "./ResourceCard.css";

export default function ResourceCard({ resource }) {
  function trackClick() {
    posthog.capture("resource_link_clicked", {
      resource_id: resource.id,
      resource_name: resource.name,
      category: resource.category,
    });
  }

  // Distinct from resource_link_clicked (the main "Read" action) so the two
  // interaction types stay distinguishable in analytics, same as before
  // this changed from a second full-width link to a badge.
  function trackDownload() {
    posthog.capture("resource_download_clicked", {
      resource_id: resource.id,
      resource_name: resource.name,
      category: resource.category,
    });
  }

  return (
    <div className="resource-card">
      <div className="resource-header">
        {resource.organization && <span className="resource-org">{resource.organization}</span>}
        {resource.verificationStatus === "moved" && (
          <span className="badge badge-moved" title="URL has changed since we last linked it">
            Updated link
          </span>
        )}
      </div>
      <h3 className="resource-name">
        {resource.name}
        {resource.isDownloadable && resource.downloadUrl && (
          <a
            href={resource.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="badge badge-download"
            onClick={trackDownload}
            title="Download"
          >
            ⬇ Download
          </a>
        )}
      </h3>
      {resource.description && <p className="resource-description">{resource.description}</p>}
      <p className="resource-curation-note">
        <span className="resource-curation-label">Why this matters</span>
        {resource.curationNote}
      </p>
      <div className="resource-actions">
        <a href={resource.url} target="_blank" rel="noopener noreferrer" onClick={trackClick}>
          Read →
        </a>
      </div>
    </div>
  );
}

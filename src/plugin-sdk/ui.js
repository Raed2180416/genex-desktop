/** Small framework-free SDK primitives; custom panels can also use their own framework. */
window.studioPlugin.ui = {
  text(tag, value) {
    const el = document.createElement(tag);
    el.textContent = String(value ?? "Unknown");
    return el;
  },
  status(label, value) {
    const row = document.createElement("p");
    const title = document.createElement("strong");
    title.textContent = label + ": ";
    row.append(title, document.createTextNode(String(value ?? "Unknown")));
    return row;
  },
  error(message) {
    const el = document.createElement("p");
    el.setAttribute("role", "alert");
    el.textContent = String(message);
    return el;
  },
  job(job) {
    const card = document.createElement("article");
    card.style.cssText = "border-top:1px solid #555;padding:12px 0";
    card.append(
      this.text("strong", job.operation ?? job.title ?? "Asset job"),
      this.status("Status", job.status),
      this.status("Use", job.use?.stage ?? "Not verified"),
      this.status("Charged credits", job.creditsCharged ?? "Not reported"),
      this.status("Refunded credits", job.creditsRefunded ?? "Not reported"),
    );
    if (job.generationId) card.append(this.status("Generation", job.generationId));
    for (const file of job.files ?? []) card.append(this.text("div", file));
    if (job.error) card.append(this.error(job.error));
    return card;
  },
};

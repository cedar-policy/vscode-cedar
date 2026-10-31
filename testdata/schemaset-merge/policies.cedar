// the owner of a document can view and edit it
@id("Document-owner")
permit (
  principal is DocApp::User,
  action in [DocApp::Action::"view", DocApp::Action::"edit"],
  resource is DocApp::Document
)
when { resource.owner == principal };

// anyone on the Writers team can view any document
@id("Writers-view")
permit (
  principal in DocApp::Team::"Writers",
  action == DocApp::Action::"view",
  resource
);

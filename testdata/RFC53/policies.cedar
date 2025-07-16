permit(
    principal is RFC53::User,
    action == RFC53::Action::"UpdateTask",
    resource is RFC53::Task)
when {
    principal == resource.owner &&
    resource.status != RFC53::Color::"Red"
};
//#region src/runtime-types.ts
function isRecord(value) {
	return typeof value === "object" && value !== null;
}
function isSafeContinuationEnvelope(value) {
	if (!isRecord(value)) return false;
	if (!isRecord(value.session) || typeof value.session.id !== "string") return false;
	if (!isRecord(value.event)) return false;
	if (typeof value.event.type !== "string") return false;
	if (typeof value.event.seq !== "number") return false;
	if (typeof value.event.time !== "number") return false;
	if (!("data" in value.event)) return false;
	if (value.session.header !== void 0) {
		if (!isRecord(value.session.header) || typeof value.session.header.id !== "string") return false;
	}
	return true;
}
function isSafeContinuationRequestContext(value) {
	if (!isRecord(value)) return false;
	if (typeof value.provider !== "string") return false;
	if (typeof value.model !== "string") return false;
	if (value.contextWindow !== void 0 && typeof value.contextWindow !== "number") return false;
	return true;
}
//#endregion
export { isSafeContinuationEnvelope, isSafeContinuationRequestContext };

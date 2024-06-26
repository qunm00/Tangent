export enum ClauseType {
	In = 'in',
	Named = 'named',
	With = 'with',
	LinkedFrom = 'linked from'
}

export enum ClauseMod {
	Any = 'any',
	All = 'all'
}

export enum ClauseGroupMod {
	Not = 'not'
}

export enum TodoQueryState {
	Any,
	Open,
	// The todo was completed
	Complete,
	// The todo was canceled
	Canceled,
	// The todo is no longer open; either complete or canceled
	Closed
}

export interface PartialClauseText {
	text: string
}

export interface PartialClauseRegex {
	regex: RegExp
}

export interface PartialClauseReference {
	reference: string
}

export interface PartialClauseQuery {
	query: Query
}

export interface QueryTagDefinition {
	names: string[]
}

export interface PartialClauseTag {
	tag: QueryTagDefinition
}

export interface PartialClauseTodo {
	todo: TodoQueryState
}

export interface PartialClauseNegate {
	clause: ClauseOrGroup
}

export type PartialClauseType = { type: ClauseType, mod?: ClauseMod }
export type PartialClauseValue = PartialClauseText | PartialClauseRegex
	| PartialClauseReference | PartialClauseQuery
	| PartialClauseTag | PartialClauseTodo
	| PartialClauseNegate

export type Clause = PartialClauseType & PartialClauseValue

export interface ClauseGroup {
	join: 'and' | 'or'
	mod?: ClauseGroupMod
	clauses: ClauseOrGroup[]
}

export type ClauseOrGroup = Clause | ClauseGroup

export interface Query extends ClauseGroup {
	forms: string[]
}

export function isClause(item: ClauseOrGroup): item is Clause {
	return typeof (item as Clause).type === 'string'
}

export function isGroup(item: ClauseOrGroup): item is ClauseGroup {
	return typeof (item as ClauseGroup).join === 'string'
}

export function isQuery(item: ClauseGroup | Query): item is Query {
	return 'forms' in item
}

import { derived, Readable } from 'svelte/store'
import type { EditorRange } from "@typewriter/document"
import { escapeRegExp } from '@such-n-such/core'
import type NodeViewState from "./NodeViewState"
import type NoteFile from "../NoteFile"
import { PartialLink, StructureType } from "common/indexing/indexTypes"
import { ForwardingStore, ReadableStore, WritableStore } from 'common/stores'
import type { StructureDelta } from 'common/indexing/structureUtils'
import type LensViewState from './LensViewState'

import NoteEditor from 'app/views/editors/NoteEditor/NoteEditor.svelte'
import type ViewStateContext from './ViewStateContext'
import { MapStrength } from 'common/tangentMap/MapNode'
import type { Annotation } from 'common/nodeReferences'
import { safeHeaderLine } from 'common/markdownModel/header'
import { lineToText } from 'common/typewriterUtils'
import { clamp } from 'common/utils'
import NoteSettingsView from 'app/views/node-views/NoteSettingsView.svelte'
import DataFile from '../DataFile'
import NoteViewInfo from 'common/dataTypes/NoteViewInfo'
import paths from 'common/paths'

export enum NoteDetailMode {
	None = 0,
	Words = 1 << 0,
	Characters = 1 << 1,
	LinkSummary = 1 << 2,
	Details = 1 << 3,

	All = Words | Characters | LinkSummary | Details,
	WordsAndChars = Words | Characters
}

export type NoteSearchData = {
	enabled: boolean
	text: string
	mode: 'text' | 'regex'
}

function searchDataToRegex(search: NoteSearchData): RegExp {
	if (!search.text) return null

	if (search.mode === 'text') {
		return RegExp(escapeRegExp(search.text), 'ig')
	}
	else if (search.mode === 'regex') {
		return RegExp(search.text, 'ig')
	}
	console.warn('Unhandled search mode', search.mode)
	return null
}

function getFolderInfoFile(context: ViewStateContext, file: NoteFile): DataFile | null {
	if (!file.meta?.uuid) {
		// TODO: Does this need to be handled?
		console.error('No UUID for', file.path)
		return null
	}
	const directory = context.getRelativePersistentStateDirectory()
	if (!directory) return null

	return context.workspace.commands.createNewFile.execute({
		relativePath: paths.join(directory, file.meta?.uuid + NoteViewInfo.fileType),
		creationMode: 'createOrOpenCaseInsensitive',
		updateSelection: false
	}) as DataFile
}

export default class NoteViewState implements NodeViewState, LensViewState {
	// Core Values
	readonly context: ViewStateContext
	readonly note: NoteFile
	
	readonly noteViewInfoFile: DataFile
	readonly noteViewInfo = new WritableStore<NoteViewInfo>(null)

	readonly currentLens: ReadableStore<LensViewState>
	readonly pinSettings: Readable<boolean>

	// Forwarded state values
	readonly selection: WritableStore<EditorRange>
	readonly scrollY: WritableStore<number>
	readonly collapsedLines: WritableStore<number[]>

	// Local Values
	detailMode: NoteDetailMode
	readonly annotations: WritableStore<Annotation[]> = new WritableStore([])
	readonly annotationIndex: WritableStore<number> = new WritableStore(-1)

	readonly search: WritableStore<NoteSearchData> = new WritableStore(null)

	protected readonly unsubs: (() => void)[]

	constructor(context: ViewStateContext, file: NoteFile, showDetails=NoteDetailMode.None) {
		this.context = context
		this.note = file

		this.selection = new ForwardingStore<EditorRange>(undefined)
		this.scrollY = new ForwardingStore<number>(undefined)
		this.collapsedLines = new ForwardingStore<number[]>(undefined)

		this.note.loadFile()
		this.noteViewInfoFile = getFolderInfoFile(context, file)
		this.noteViewInfoFile?.loadData<NoteViewInfo>().then(info => {
			this.noteViewInfo.set(info)
			if (info) {
				;(this.selection as ForwardingStore<EditorRange>).forwardFrom(info.selection)
				;(this.scrollY as ForwardingStore<number>).forwardFrom(info.scrollY)
				;(this.collapsedLines as ForwardingStore<number[]>).forwardFrom(info.collapsedLines)
			}
		})

		this.detailMode = showDetails

		this.currentLens = new ReadableStore(this)
		this.pinSettings = derived([this.search, this.annotations], ([search, annotations]) => {
			return search?.enabled || annotations.length > 1
		})

		this.unsubs = [
			this.note.observeStructureChanges(delta => {
				this.onStructureChange(delta)
			}),
			this.search.subscribe(search => this.onSearchChanged(search)),
			this.note.subscribe(note => this.onSearchChanged(this.search.value)),
		]
	}

	get node() { return this.note }

	// Lens interface
	get parent() { return this }
	get viewComponent() { return NoteEditor }

	onStructureChange(delta: StructureDelta) {
		const session = this.context.tangent.activeSession.value
		if (!session) {
			console.error('No session found for view state!', this)
		}

		const map = session.map
		const node = this.node

		session.undoStack.withUndoGroup(() => {
			// Ensure this node is on the map
			const mapNode = map.getOrCreate(node, MapStrength.Navigated)

			for (const removed of delta.removed) {
				if (removed.type === StructureType.Link || removed.type === StructureType.Embed) {
					const connection = map.findConnection(mapNode, removed.to)
					if (connection && connection.strength.value === MapStrength.Connected) {
						const to = connection.to.value
						// Only remove automatic connections
						map.disconnect(connection)
						// Clear out nodes that no longer need to be here
						if (to.strength.value === MapStrength.Connected
							&& to.incoming.length === 0
							&& to.outgoing.length === 0) {
							map.delete(to)
						}
					}
				}
			}

			for (const added of delta.added) {
				if (added.type === StructureType.Link || added.type === StructureType.Embed) {
					if (added.to) {
						map.connect({
							from: mapNode,
							to: added.to,
							strength: MapStrength.Connected,
							preventRecursiveLinks: true
						})
					}
				}
			}
		})
	}

	dispose() {
		this.note.dropFile()
		this.noteViewInfoFile.unloadFile()
		for (const unsub of this.unsubs) {
			unsub()
		}
	}

	focus(element: HTMLElement) {
		const list = element?.querySelectorAll('.noteEditor')
		if (list) {
			let targetEditorElement: HTMLElement = null
			let wasAnyActive = false

			list.forEach(noteEditor => {
				const editorElement = noteEditor.querySelector('article')
				const headerElement = noteEditor.querySelector('header > .title')
				if (!targetEditorElement) {
					targetEditorElement = editorElement
				}
				if (document.activeElement === editorElement || document.activeElement === headerElement) {
					wasAnyActive = true
				}
			})

			if (!wasAnyActive && targetEditorElement) {
				targetEditorElement.dispatchEvent(new Event('resumeFocus'))
				return true
			}
		}
	}

	highlightLink(link: PartialLink) {
		if (this.note.isReady) {
			this.highlightLinkInternal(link)
		}
		else {
			let reset: () => void = null
			const wait = note => {
				if (note.isReady) {
					reset()
					this.highlightLinkInternal(link)
				}
			}
			reset = this.note.subscribe(wait)
		}
	}

	private highlightLinkInternal(link: PartialLink) {
		let annotation: Annotation = { start: -1, end: -1, data: link }
		if (link.start != null && link.end != null) {
			annotation.start = link.start
			annotation.end = link.end
		}
		else if (link.content_id) {
			const id = link.content_id
			// Look for headers
			let start = 0
			for (const line of this.note.lines) {
				if (line.attributes.header && safeHeaderLine(lineToText(line)) === id) {
					annotation.start = start
					annotation.end = start + line.length
					break
				}
				start += line.length
			}
		}

		if (annotation.start >= 0 || annotation.end >= 0) {
			this.annotations.update(a => [...a, annotation])
			this.annotationIndex.set(this.annotations.value.length - 1)
		}
	}

	setAnnotations(annotations: Annotation[], index?: number) {
		this.annotations.set(annotations)
		this.annotationIndex.set(annotations.length === 0 ? -1 : clamp(index ?? this.annotationIndex.value ?? 0, 0, annotations.length - 1))
	}

	setSearch(text?: string) {
		this.search.update(search => {
			text = text ?? search?.text ?? ''
			const mode = search?.mode ?? 'text'
			if (!search) {
				return {
					text,
					enabled: true,
					mode
				}
			}
			return {
				text,
				enabled: true,
				mode
			}
		})
	}

	protected onSearchChanged(search: NoteSearchData) {
		if (!search) return

		let annotations: Annotation[] = []

		if (search.enabled) {
			const matcher = searchDataToRegex(search)
			if (matcher) {
				let lineStart = 0
				const message = 'Matches ' + search.text
				for (const line of this.note.lines) {
					const lineText = lineToText(line)

					const match = lineText.matchAll(matcher)
					if (match) {
						for (const m of match) {
							const start = lineStart + m.index
							annotations.push({
								start,
								end: start + m[0].length,
								data: message
							})
						}
					}
					lineStart += line.length
				}
			}
		}

		this.setAnnotations(annotations)
	}

	get settingsComponent() {
		return NoteSettingsView
	}
}

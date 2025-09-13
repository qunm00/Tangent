import type { FormatType, LineType, TypesetTypes } from 'typewriter-editor/dist/typesetting'
import { h } from 'typewriter-editor/dist/rendering/vdom'
import katex from 'katex'
import type { IndentDefinition } from './line'
import { isEqual, type AttributeMap } from '@typewriter/document'
import type { ListDefinition } from './list'
import type { TagSectionData } from './tag'
import { CodeData } from './code'
import { MathData } from './math'
import { hasCollapsedChildren, isCollapsed } from './sections'

const defaultOptions = {}

function getHideableFormatClass(attributes, baseClass = '') {
	let className = baseClass

	if (attributes.hidden) {
		className += ' hidden'
	}
	if (attributes.start) {
		className += ' start'
	}
	if (attributes.end) {
		className += ' end'
	}
	if (attributes.revealed) {
		className += ' revealed'
	}
	
	return className
}

function hideableFormat(
	formatName: string,
	options?: {
		elementName?: string,
		attributeClasses?: string[],
		attributes?: any
	}): FormatType
{
	options = options || defaultOptions
	const elementName = options.elementName || 'span'

	return {
		name: formatName,
		selector: `${elementName}.${formatName}`,
		render: (attributes, children) => {
			
			let className = getHideableFormatClass(attributes, formatName)

			let formatAttribute = attributes[formatName]
			if (typeof formatAttribute === 'string') {
				className += ' ' + formatAttribute
			}

			if (options.attributeClasses) {
				for (const attr of options.attributeClasses) {
					if (attributes[attr]) {
						className += ' ' + attr
					}
				}
			}

			let elementAttributes: AttributeMap = {
				class: className,
				...options?.attributes
			}

			if (attributes.spellcheck != undefined) {
				elementAttributes.spellcheck = attributes.spellcheck
			}

			return h(elementName, elementAttributes, children)
		}
	}
}

function revealableLine(lineName: string, elementName: string = 'div'): LineType {
	return {
		name: lineName,
		selector: `${elementName}.${lineName}`,
		defaultFollows: true,
		render: (attributes, children) => {
			return h(
				elementName,
				getCoreLineProperties(attributes, lineName),
				children)
		},
		fromDom: defaultLineFromDom(lineName)
	}
}

function getCoreLineProperties(attributes, baseClass = ''): AttributeMap {

	const props: AttributeMap = {
		className: baseClass + ' line',
		dir: 'auto' // for RTL language support
	}

	const collapsed = attributes.collapsed
	if (typeof collapsed === 'number') {
		// Store the raw value so it can be recovered from the HTML if necessary
		props['data-collapsed'] = collapsed
		if (isCollapsed(collapsed)) {
			props.className += ' collapsed'
		}
		if (hasCollapsedChildren(collapsed)) {
			props.className += ' collapse-parent'
		}
	}
	
	if (attributes.collapsedReveal) {
		props.className += ' collapsed-revealed'
	}

	if (attributes.hidden) {
		props.className += ' hidden'
	}
	if (attributes.revealed) {
		props.className += ' revealed'
	}
	if (attributes.empty) {
		props.className += ' empty'
	}

	const indent = attributes.indent as IndentDefinition
	if (indent) {
		props.style = getLineIndentStyle(indent.indentSize)
	}

	const decoration = attributes.decoration
	if (decoration) {
		for (const dec of Object.values(decoration)) {
			for (const key of Object.keys(dec)) {
				if (key === 'class') {
					// Since this touches the class, need to reimplement decoration classes
					props.className += ' ' + dec[key]
				}
				else {
					props[key] = dec[key]
				}
			}
		}
	}
	
	return props
}

function extractCoreLineProperties(element: HTMLElement, attributes: AttributeMap) {
	const collapsed = element.getAttribute('data-collapsed')
	if (collapsed) {
		attributes.collapsed = parseInt(collapsed)
	}
}

function defaultLineFromDom(name: string){
	return (element: HTMLElement) => {
		const attributes: AttributeMap = { [name]: true }
		extractCoreLineProperties(element, attributes)
		return attributes
	}
}

function getLineIndentStyle(indent: number) {
	return '--lineIndent: ' + indent + ';'
}

function codeFormatAltClass(type: string) {
	switch (type) {
		case 'key':
			return 'keyword'
	}
}

const noteTypeset:TypesetTypes = {
	lines: [
		{
			name: 'line',
			selector: 'p',
			render: (attributes, children) => {
				return h('p', getCoreLineProperties(attributes), children)	
			},
			fromDom: defaultLineFromDom('line')
		},
		{
			name: 'header',
			selector: 'h1, h2, h3, h4, h5, h6',
			defaultFollows: true,
			render: (attributes, children) => h(`h${attributes.header}`, getCoreLineProperties(attributes), children),
			fromDom: defaultLineFromDom('header') // Technically incorrect, but will be re-parsed anyhow
		},
		{
			name: 'list',
			selector: 'p.list',
			defaultFollows: true,
			render: (attributes, children) => {
				const listData = attributes.list as ListDefinition
				let props = getCoreLineProperties(attributes, 'list') as any
				props.listForm = listData.form
				props.listGlyph = listData.glyph

				if (listData.todoState) {
					props.className += ' checkbox ' + listData.todoState
				}

				return h('p', props, children)
			},
			fromDom: defaultLineFromDom('list')
		},
		{
			name: 'blockquote',
			selector: 'blockquote p',
			defaultFollows: false,
			fromDom(node: HTMLElement) {
				const { className } = node.parentElement
				const match = className.match(/depth-(\d+)/)
				const blockquote = parseInt(match && match[1])
				const attributes: AttributeMap = { blockquote }
				extractCoreLineProperties(node, attributes)
				return attributes
			},
			shouldCombine: (prev, next) => {
				return prev.blockquote === next.blockquote
					&& isEqual(prev.indent, next.indent)
			},
			renderMultiple: lineData => {
				let depth = lineData[0][0].blockquote
				let revealed = false
				let indent = -1

				const children = lineData.map(([attributes, children, id]) => {
					if (indent === -1) indent = attributes.indent.indentSize
					if (attributes.revealed) revealed = true

					let props = getCoreLineProperties(attributes, 'blockquote')
					props.style = `--innerLineIndent: ${indent};` // Replace indent
					props.key = id

					return h('p', props, children)
				})

				let className = 'depth-' + depth
				if (revealed) {
					className += ' revealed'
				}

				let style = ''
				if (indent) {
					style += getLineIndentStyle(indent)
				}

				return h('blockquote', { className, style }, children)
			}
		},
		{
			name: 'code',
			selector: 'pre code div.codeLine',
			defaultFollows: true,
			fromDom(node: HTMLElement) {
				const { className } = node.parentElement
				const match = className.match(/language-(.*)/)
				const result: AttributeMap = {}
				if (match && match[1] !== 'none') {
					result.code = {
						language: match[1]
					}
				}
				extractCoreLineProperties(node, result)
				return result
			},
			shouldCombine: (prev, next) => {
				return isEqual(prev.code, next.code)
					&& prev.indent.indent === next.indent.indent
			},
			renderMultiple: lineData => {
				let isRevealed = false
				let indent = -1
				const children = lineData.map(([attributes, children, id]) => {
					if (attributes.revealed) isRevealed = true
					if (indent === -1) indent = attributes.indent.indentSize

					let props = getCoreLineProperties(attributes, 'codeLine')
					props.key = id

					return h('div', props, children)
				})

				const codeData = lineData[0][0].code as CodeData
				const codeLanguage = codeData.language
				const className = codeLanguage ? `language-${codeLanguage}` : 'language-none'

				let preClass = className
				let preStyle = ''
				if (indent) {
					preStyle += getLineIndentStyle(indent)
					preClass += ' indented'
				}
				if (isRevealed) {
					preClass += ' revealed'
				}
				
				const content = h(
					'pre',
					{
						className: preClass,
						spellcheck: false,
						style: preStyle
					},
					h(
						'code',
						{
							className
						},
						children
					)
				)

				if (codeData.source) {
					return h('figure', { }, [
						content,
						h('t-code-preview', {
							language: codeData.language,
							source: codeData.source
						})
					])
				}
				return content
			}
		},
		{
			name: 'front_matter',
			selector: 'div.frontMatter code div.frontMatterLine',
			defaultFollows: true,
			fromDom: defaultLineFromDom('front_matter'),
			shouldCombine: (prev, next) => {
				return prev.front_matter === next.front_matter
			},
			renderMultiple: lineData => {
				const children = lineData.map(([attributes, children, id], index) => {
					let props = getCoreLineProperties(attributes, 'frontMatterLine')
					props.key = id
					if (index === 0) {
						props.className += ' start'
					}
					else if (attributes.end) {
						props.className += ' end'
					}
					return h('div', props, children)
				})
				return h('div', { className: 'frontMatter', spellcheck: false }, h('code', null, children))
			}
		},
		{
			name: 'math',
			selector: 'figure pre code div.mathLine',
			defaultFollows: true,
			fromDom: defaultLineFromDom('math'),
			shouldCombine: (prev, next) => {
				return prev.math.source === next.math.source
					&& prev.indent.indent === next.indent.indent
			},
			renderMultiple: lineData => {
				let math: MathData = null
				let indent = -1
				let revealed = false
				const codeChildren = lineData.map(([attributes, children, id]) => {
					if (!math) math = attributes.math
					if (indent === -1) indent = attributes.indent.indentSize
					if (attributes.revealed) revealed = true
					let props = getCoreLineProperties(attributes, 'mathLine')
					props.key = id

					return h('div', props, children)
				})

				const codeClass = 'language-latext'
				let preClass = codeClass + ' hidden'

				let mathClass = ''
				let mathStyle = ''

				if (indent) {
					mathStyle += getLineIndentStyle(indent)
					mathClass += ' indented'
				}
				if (revealed) {
					preClass += ' revealed'
					mathClass += ' revealed'
				}

				return h('figure', { }, [
					h('pre',
						{
							className: preClass,
							spellcheck: false
						},
						h(
							'code',
							{
								className: codeClass
							},
							codeChildren
						)
					),
					h('t-math',
						{
							'math-source': math.source,
							'block': '',
							className: mathClass,
							style: mathStyle
						}
					)
				])
			}
		},
		revealableLine('horizontal_rule', 'p')
	],
	formats: [
		// Formatting that starts a line
		{
			name: 'line_format',
			selector: 'span.line_format',
			render: (attributes, children) => {
				let props = {
					className: getHideableFormatClass(attributes, 'line_format ' + attributes.line_format)
				} as any

				// This needs to work with all line prefixing

				if (attributes.list_format) {
					const listData = attributes.list_format as ListDefinition
					props.listGlyph = listData.glyph
					if (listData.todoState != null) {
						props.className += ' checkbox'
					}
				}

				return h('span', props, children)
			}
		},

		{
			name: 'line_comment',
			selector: 'span.line_comment',
			render: (attributes, children) => {
				let className = 'comment line_comment'
				if (attributes.line_comment === 'start') {
					className += ' start hidden'
					if (attributes.revealed) {
						className += ' revealed'
					}
				}
				return h('span', { className }, children)
			}
		},

		{
			name: 'list_format',
			selector: 'span.list_format',
			render: (attributes, children: any) => {
				let className = 'list_format'

				const listData = attributes.list_format as ListDefinition

				if (attributes.revealed) {
					className += ' revealed'
				}

				if (listData.todoState != undefined) {
					className += ' checkbox'
					if (!attributes.revealed) {
						children = [
							h('span', { className: 'text' }, children),
							h('t-checkbox', {
								state: listData.todoState
							})
						]
					}
				}
				else {
					children = h('span', { className: 'text' }, children)
				}

				return h('span', {
					className,
					listGlyph: listData.glyph
				}, children)
			}	
		},

		{
			name: 't_embed',
			selector: '.t-embed',
			render: (attributes, children) => {
				let className = 't-embed'
				if (attributes.revealed) {
					className += ' revealed'
				}

				let node = h(
					'span',
					{
						class: className,
					},
					children
				) as any
				
				// forward the link information
				node.t_embed_props = attributes.t_link

				return node
			},
			postProcess: (node) => {
				node.children.push(h(
					't-embed',
					(node as any).t_embed_props
				))
				return node;
			}
		},

		{
			name: 't_link',
			selector: 't-link',
			render: (attributes, children) => {
				let className = ''
				if (attributes.revealed) {
					className += ' revealed'
				}
				return h(
					't-link',
					{
						class: className,
						...attributes.t_link
					},
					children)
			}
		},

		{
			name: 'highlight',
			selector: 'mark',
			render: (attributes, children) => {
				let className = getHideableFormatClass(attributes)
				if (typeof attributes.highlight === 'string') {
					className += ' ' + attributes.highlight
				}
				return h('mark', { className }, children)
			}
		},

		hideableFormat('inline_code',
			{
				elementName: 'code',
				attributeClasses: ['afterSpace', 'beforeSpace'],
				attributes: {
					spellcheck: false
				}
			}),

		hideableFormat('italic', { elementName: 'em' } ),
		hideableFormat('bold', { elementName: 'strong' }),
		hideableFormat('strikethrough', { elementName: 's' }),

		{
			name: 'error',
			selector: 'span.error',
			render: (attributes, children) => {

				const className = 'error'
				const title = attributes.error

				return h('span', { className, title }, children)
			}
		},

		{
			name: 'warning',
			selector: 'span.warning',
			render: (attributes, children) => {

				const className = 'warning'
				const title = attributes.warning

				return h('span', { className, title }, children)
			}
		},

		{
			name: 'code_syntax',
			selector: 'span.code_syntax',
			render: (attributes, children) => {
				let className = 'code_syntax token'
				if (typeof attributes.code_syntax === 'string') {
					className += ' '
					className += attributes.code_syntax

					const alts = codeFormatAltClass(attributes.code_syntax)
					if (alts) {
						className += ' '
						className += alts
					}
				}

				return h('span', { className }, children)
			}
		},

		{
			name: 'tag',
			selector: 'span.tag',
			render: (attributes, children) => {
				const tag = attributes.tag as string[]
				let className = 'tag TAG-' + tag.join('--')
				if (attributes.revealed) {
					className += ' revealed'
				}
				const props = {
					className,
					spellcheck: false
				}
				return h('span', props, children)
			}
		},
		{
			name: 'tag_section',
			selector: 'span.tag_section',
			render: (attributes, children) => {
				const section = attributes.tag_section as TagSectionData
				let className = 'tagSection TAG-' + section.name + ' tagSectionDepth-' + section.depth
				if (section.depth === section.totalDepth) {
					className += ' last'
				}
				if (attributes.revealed) {
					className += ' revealed'
				}
				const props = {
					className
				}
				return h('span', props, children)
			}
		},
		{
			name: 'tag_seperator',
			selector: 'span.tagSeperator',
			render: (attributes, children) => {
				const seperator = attributes.tag_seperator
				let className = 'tagSeperator' + ' tagSeperatorDepth-' + seperator.depth
				className += ' tagSeperator--' + seperator.prev + '--' + seperator.next
				if (attributes.revealed) {
					className += ' revealed'
				}
				const props = {
					className
				}
				return h('span', props, children)
			}
		},

		{
			name: 'math',
			selector: 'span.math',
			render: (attributes, children) => {
				let className = 'math hidden'
				
				let mathAttr = {
					'math-source': attributes.math.source,
				} as any

				if (attributes.revealed) {
					className += ' revealed'
					mathAttr.className = 'revealed'
				}

				if (attributes.math.isBlock) {
					mathAttr.block = ''
				}

				return h('span', {}, [
					h('span', { className }, children),
					h('t-math', mathAttr, [])
				])
			}
		},

		hideableFormat('link_internal'),
		hideableFormat('tag_internal')
	]
}

// Initialize with the attributes not directly attached to types
let formatClearSet = {
	hidden: null,
	hiddenGroup: null,
	revealed: null,
	end: null,
	start: null,
	beforeSpace: null,
	afterSpace: null
}
for (const format of noteTypeset.formats) {
	if (typeof format === 'string') {
		formatClearSet[format] = null
	}
	else {
		formatClearSet[format.name] = null
	}
}

export const negativeInlineFormats = formatClearSet

export default noteTypeset

import { BrowserWindow, Menu, MenuItemConstructorOptions, shell } from 'electron'
import path from 'path'
import os from 'os'
import { mode } from './environment'
import { isMac } from '../common/platform'
import { disableRendererActions } from './menus'
import { checkForUpdatesThrottled } from './updates'
import WindowHandle from './WindowHandle'
import { contentsMap, workspaceMap } from './workspaces'
import { ipcMain } from 'electron'
import { cleanMenuTemplate } from '../common/menus'
import { getSettings } from './settings'
import { addShutDownTask } from './shutdown'
import { wait } from '@such-n-such/core'

let defaultLanguages = null

function getTitleBarStyle() {
	if (isMac) return 'hiddenInset'
	if (getSettings().titlebar.value === 'condensed') return 'hidden'
	return 'default'
}

export function createWindow(assignedWorkspace?: string) {
	// Create the browser window.

	let windowOptions: Electron.BrowserWindowConstructorOptions = {
		width: 2000,
		height: 1200,
		minWidth: 100,
		minHeight: 100,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js')
		},
		show: false,
		autoHideMenuBar: getTitleBarStyle() == 'default',
		titleBarStyle: getTitleBarStyle()
	}

	if (os.platform() === 'linux') {
		// To work around an icon issue, apply the icon to the window directly
		windowOptions.icon = path.join(__dirname, '../../static/tangent_256.png')
	}

	const newWindow = new BrowserWindow(windowOptions)

	newWindow.once('ready-to-show', () => {
		newWindow.show()
	})

	let handle = new WindowHandle(newWindow)
	contentsMap.set(newWindow.webContents, handle)
	handle.assignedWorkspacePath = assignedWorkspace || null

	newWindow.on('focus', () => {
		disableRendererActions()
		newWindow.webContents.send('getAllMenus')

		checkForUpdatesThrottled()
	})

	newWindow.webContents.on('context-menu', (event, input) => {
		// This delay is _sketchy_.
		// The window (see Workspace.showContextMenu) wants to delay to the next loop so that selection changes can propegate.
		// That means that the customization wouldn't make it in time. This delay lets the customizations arrive.
		wait(10).then(() => {
			const template: MenuItemConstructorOptions[] = []

			const customizations = handle.contextMenuCustomizations
			delete handle.contextMenuCustomizations

			if (customizations?.top) {
				template.push(...customizations.top)
			}

			if (input.misspelledWord) {

				template.push({ type: 'separator' })

				if (input.dictionarySuggestions.length === 0) {
					template.push({
						label: 'No Guesses Found',
						enabled: false
					})
				}

				for (const suggestion of input.dictionarySuggestions) {
					template.push({
						label: `Replace with "${suggestion}"`,
						click: () => newWindow.webContents.replaceMisspelling(suggestion)
					})
				}

				template.push(
					{
						label: `Add "${input.misspelledWord}" to dictionary`,
						click: () => newWindow.webContents.session.addWordToSpellCheckerDictionary(input.misspelledWord)
					},
					{ type: 'separator' }
				)
			}

			if (input.isEditable) {

				// Pull the main menu items for accelerator rebinding
				const mainMenu = Menu.getApplicationMenu()
				const copy = mainMenu.getMenuItemById('window_copy')
				const cut = mainMenu.getMenuItemById('window_cut')
				const paste = mainMenu.getMenuItemById('window_paste')
				const pasteAndMatchStyle = mainMenu.getMenuItemById('window_pasteAndMatchStyle')

				template.push(
					{ type: 'separator' },
					{
						label: 'Copy',
						accelerator: copy?.accelerator,
						registerAccelerator: false,
						enabled: input.editFlags.canCopy,
						click: () => {
							newWindow.webContents.copy()
						}
					},
					{
						label: 'Cut',
						accelerator: cut?.accelerator,
						registerAccelerator: false,
						enabled: input.editFlags.canCut,
						click: () => {
							newWindow.webContents.cut()
						}
					},
					{
						label: 'Paste',
						accelerator: paste?.accelerator,
						registerAccelerator: false,
						enabled: input.editFlags.canPaste,
						click: () => {
							newWindow.webContents.paste()
						}
					},
					{
						label: 'Paste and Match Style',
						accelerator: pasteAndMatchStyle?.accelerator,
						registerAccelerator: false,
						enabled: input.editFlags.canPaste,
						click: () => {
							newWindow.webContents.pasteAndMatchStyle()
						}
					},
					{ type: 'separator' }
				)
			}

			if (customizations?.middle) {
				template.push(...customizations.middle)
			}

			if (customizations?.bottom) {
				template.push(...customizations.bottom)
			}

			const menu = Menu.buildFromTemplate(cleanMenuTemplate(template))
			menu.popup()
		})
	})

	// Handle links by default
	newWindow.webContents.setWindowOpenHandler(details => {
		shell.openExternal(details.url)
		return { action: 'deny' }
	})

	// and load the index.html of the app.
	newWindow.loadFile(path.join(__dirname, '../../static/index.html'))

	if (mode === 'development' && !process.env.INTEGRATION_TEST) {
		// Open the DevTools.
		newWindow.webContents.openDevTools()
	}

	if (!defaultLanguages) {
		defaultLanguages = newWindow.webContents.session.getSpellCheckerLanguages()
	}

	const settings = getSettings()
	const settingUnsubs = [
		settings.spellCheckLanguages.subscribe(langs => {
			const newLangs = [
				...defaultLanguages,
				...langs
			]
			newWindow.webContents.session.setSpellCheckerLanguages(newLangs)
		}),
		settings.enableSpellCheck.subscribe(enabled => {
			newWindow.webContents.session.setSpellCheckerEnabled(enabled)
		})
	]

	newWindow.on('close', () => {
		settingUnsubs.forEach(i => i())

		let handle = contentsMap.get(newWindow.webContents)
		if (handle) {
			// Save out the window state
			addShutDownTask(handle.close())

			if (isMac || contentsMap.size > 1) {
				// On windows/linux do not flush the last window.
				// That will happen on 'windows-all-closed'
				contentsMap.delete(newWindow.webContents)
			}
		}
	})

	return newWindow
};

export function getOrCreateWindowForWorkspace(workspacePath: string): BrowserWindow {
	for (const handle of contentsMap.values()) {
		if (handle.assignedWorkspacePath === workspacePath) {
			return handle.window
		}
	}

	return createWindow(workspacePath)
}

ipcMain.handle('createWindow', (event) => {
	createWindow()
})

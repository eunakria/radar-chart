const defaultValue = `\
# This is a key-value description of factors about the chart.
# Lines that begin with a pound sign are comments. Whitespace clusters are
# just for readability; you don't need to write with them. However, leading
# whitespace itself _is_ important; it signifies a continuation.

size: 400 x 400
margin: 10
background: white
#interval background: white
text color: black
text size: 16
stroke color: grey
#interval stroke color: black
main stroke width: 1
entry stroke width: 2
filled entries: yes

# You can specify 'none' to not draw interval lines.
scale: 100
intervals: 20
#interval labels: E D C B A S
#hide labels: no

# Which way to angle the chart. Either 'first radius',
# 'first side' or 'last side'.
top: first radius

# Specify each of the radii, or spokes, of the chart.
radii: 5
radius 1: Speed
       2: Reliability
       3: Comfort
       4: Safety
       5: Efficiency

# Specify each entry. Later-numbered ones go on top when
# using filled entries.
entries: 2
entry 1  data: 90 60 45 75 40
        color: #0000ff
      2  data: 60 80 60 30 90
        color: #ff8000
`

class Throttle {
	constructor(func, freq) {
		this.func = func
		this.freq = freq
		this.timeout = undefined
	}

	fire() {
		clearTimeout(this.timeout)
		this.timeout = setTimeout(this.func, this.freq)
	}
}

const $ = x => document.querySelector(x)

CodeMirror.defineSimpleMode('simplemode', {
	start: [
		{ regex: /#.*/, sol: true, token: 'comment' },
		{ regex: /.*?:/, sol: true, token: 'bold' },
	],
})

let inputField = CodeMirror($('#input'), {
	value: defaultValue,
	lineNumbers: true,
	height: '400px',
	theme: 'q',
})

$('#download').addEventListener('click', () => {
	let svgData = $('#chart').outerHTML
	let blob = new Blob([new TextEncoder().encode(svgData)], {
		type: 'image/svg+xml',
	})

	let dl = $('#perform-download')
	dl.setAttribute('href', URL.createObjectURL(blob))
	dl.setAttribute('download', 'chart.svg')
	dl.click()
})

$('#update').addEventListener('click', () => update())

$('#auto-update').addEventListener('click', () => {
	$('#update').disabled = $('#auto-update').checked
})

let throttledUpdate = new Throttle(() => update(), 500)
inputField.on('change', () => {
	if ($('#auto-update').checked) {
		throttledUpdate.fire()	}
})

update()

function update() {
	let didError = false

	// Parse the input
	let input = (inputField.getValue()
		.split('\n').map((ln, idx) => [idx + 1, ln])
		.filter(([_idx, ln]) => !ln.match(/^#|^\s*$/)))

	let curStack = []
	let dataMap = new Map()

	for (let [idx, ln] of input) {
		if (!ln.match(':')) {
			error('Parsing error', idx)
			return
		}

		let isCont = ln.match(/^\s+/)
		if (isCont) {
			ln = ln.substr(isCont[0].length)
		}

		let colonPos = ln.match(':').index
		let key = ln.substr(0, colonPos).split(/\s+/)
		let val = ln.substr(colonPos + 1).replace(/^\s+/, '')
		if (isCont) {
			// Pop the last N_key items from curStack, and append key to
			// curStack, which shall yield the complete key.
			curStack.splice(curStack.length - key.length, key.length, ...key)
			key = curStack
		} else {
			curStack = key
		}
		key = key.join(' ')

		if (dataMap.has(key)) {
			error('Duplicate key', idx)
			return
		}
		dataMap.set(key, [idx, val])
	}

	// Now that we have a key-value map, start assembling facts about
	// the chart.
	let props = {
		radii: [],
		entries: [],
	}

	for (let [key, [idx, val]] of dataMap) {
		// These are all the "simple" properties. The check and conversion
		// from readable value to property is very simple. Most of these can
		// be forgotten about, except 'scale' and 'interval', which will have
		// to be tested against each other later.

		if (key === 'size') {
			let match = val.match(/^\s*(\d+)\s*x\s*(\d+)\s*$/)
			if (match) {
				props.width = parseInt(match[1])
				props.height = parseInt(match[2])
			} else {
				errImproper(key, idx)
				return
			}
		}

		else if ([
			'background', 'text color', 'stroke color',
			'interval background', 'interval stroke color',
		].includes(key)) {
			key = key.replace(/ (\w)/g, (_, g1) => g1.toUpperCase())
			props[key] = val
		}

		else if (['filled entries', 'hide labels'].includes(key)) {
			let nKey = key.replace(/ (\w)/g, (_, g1) => g1.toUpperCase())
			val = val.trim()
			props[nKey] =
				val === 'yes' ? true :
				val === 'no' ? false :
				errImproper(key, idx)
			if (didError) { return }
		}
		
		else if (key === 'top') {
			val = val.trim()
			props.top =
				val === 'first radius' ? 'fr' :
				val === 'first side' ? 'fs' :
				val === 'last side' ? 'ls' :
				errImproper(key, idx)
			if (didError) { return }
		}

		else if (key === 'interval labels') {
			props.intLabels = val.trim().split(/\s+/)
		}

		// This condition accounts for multiple properties to avoid
		// repetition. There are better ways to handle this, but I'm too
		// tired to really care.

		else if ([
			'radii', 'entries', 'scale', 'intervals', 'margin',
			'text size', 'main stroke width', 'entry stroke width',
		].includes(key)) {
			let numVal = safeParseInt(val)
			if (numVal === null) {
				if (key === 'intervals' && val.trim() === 'none') {
					props.intervals = null
				} else {
					errImproper(key, idx)
					return
				}
			}
			let minimums = {
				radii: 3,
				entries: 1,
				scale: 1,
				intervals: 1,
				margin: 0,
				'text size': 8,
				'main stroke width': 1,
				'entry stroke width': 1,
			}
			if (numVal < minimums[key]) {
				error(`Value for ${key} must be at least ${minimums[key]}`, idx)
				return
			}

			if (key === 'radii') {
				key = 'numRadii'
			} else if (key === 'entries') {
				key = 'numEntries'
			} else if (key.match(/ /)) {
				key = key.replace(/ (\w)/g, (_, g1) => g1.toUpperCase())
			}
			props[key] = numVal
		}

		// These are the two complicated properties. The property builder code
		// has to perform a fair amount more checks for these two.

		else if (key.match(/^radius /)) {
			let els = key.split(' ')
			if (els.length !== 2) {
				error('Invalid radius spec', idx)
				return
			}

			let radiusIdx = safeParseInt(els[1])
			if (radiusIdx === null) {
				error('Invalid radius spec', idx)
				return
			}
			if (radiusIdx < 1) {
				error('Radius spec out of range', idx)
				return
			}

			if (props.radii[radiusIdx - 1] === undefined) {
				props.radii[radiusIdx - 1] = val
			}
		}

		else if (key.match(/^entry /)) {
			let els = key.split(' ')
			if (els.length !== 3) {
				error('Invalid entry spec', idx)
				return
			}

			let entryIdx = safeParseInt(els[1])
			if (entryIdx === null) {
				error('Invalid entry spec', idx)
				return
			}
			if (entryIdx < 1) {
				error('Entry spec out of range', idx)
				return
			}

			if (props.entries[entryIdx - 1] === undefined) {
				props.entries[entryIdx - 1] = {}
			}

			let charac = els[2] // mnemonic: characteristic
			if (charac === 'data') {
				if (props.entries[entryIdx - 1].data !== undefined) {
					error(`Duplicate definition of entry ${entryIdx}'s data.`, idx)
					return
				}

				let nums = (val.trim().split(/\s+/)
					.map(subVal => safeParseInt(subVal)))
				let nullIdx = nums.findIndex(i => i === null)
				if (nullIdx !== -1) {
					error(`Data property ${nullIdx+1} is not a number.`, idx)
					return
				}

				props.entries[entryIdx - 1].data = nums

			} else if (charac === 'color') {
				props.entries[entryIdx - 1].color = val

			} else {
				error(`Unknown characteristic '${charac}' of entry.`, idx)
			}
		}

		else {
			error(`Invalid property '${key}'`, idx)
			return
		}
	}
	
	// Alright, we're done! Good job making it to the end :)
	// We still have a few more checks to perform, comparing values to each
	// other; they're listed here.
	if (
		props.intervals !== null &&
		(props.intervals >= props.scale || props.scale % props.intervals !== 0)
	) {
		error('Intervals do not evenly fit into scale',
			dataMap.get('intervals')[0])
		return
	}
	if (!arrayConsistent(props.radii, props.numRadii)) {
		error('Number of radii does not match defined radii',
			dataMap.get('radii')[0])
		return
	}
	if (!arrayConsistent(props.entries, props.numEntries)) {
		error('Number of entries does not match defined entries',
			dataMap.get('entries')[0])
		return
	}
	if (props.intLabels === undefined) {
		props.intLabels = []
		for (let val = 0; val <= props.scale; val += props.intervals) {
			props.intLabels.push(val.toString())
		}
	} else if (props.intLabels.length !== props.scale/props.intervals + 1) {
		let n = props.scale / props.intervals + 1
		error(`Incorrect number of interval labels (expected ${n})`,
			dataMap.get('interval labels')[0])
		return
	}
	if (props.intervalStrokeColor === undefined) {
		props.intervalStrokeColor = props.textColor
	}
	if (props.intervalBackground === undefined) {
		props.intervalBackground = props.background
	}
	if (props.hideLabels === undefined) {
		props.hideLabels = false
	}

	// First 'entries' to get the list of entries in the graph, second
	// 'entries' to iterate with index
	for (let [idx, entry] of props.entries.entries()) {
		let {color, data} = entry
		if (color === undefined) {
			error('Partially undefined graph entry',
				dataMap.get(`entry ${idx+1} data`)[0])
			return
		}
		if (data === undefined) {
			error('Partially undefined graph entry',
				dataMap.get(`entry ${idx + 1} color`)[0])
			return
		}

		if (data.length !== props.numRadii) {
			error('Number of data items does not match defined radii',
				dataMap.get(`entry ${idx+1} data`)[0])
			return
		}
	}

	// Finally, we're done with the integrity checks! Time to build the graph!
	drawGraph(props)

	function arrayConsistent(arr, len) {
		return arr.length === len && !arr.includes(undefined)
	}

	function safeParseInt(str) {
		let match = str.match(/^\s*(\d+)\s*$/)
		if (match) {
			return parseInt(match[1])
		} else {
			return null
		}
	}

	function errImproper(key, line) {
		error(`Improper ${key} declaration`, line)
	}
	function error(cause, line) {
		didError = true

		// HTML escape the cause, since we're setting innerHTML
		cause = cause.replace(/<|&/g, mat => `&${mat==='<'?'lt':'amp'};`)

		$('#alert').innerHTML = `<b>${cause}</b> at ln. ${line}`
		$('#alert').style.display = 'block'
		$('#chart').style.display = 'none'
	}
}

function drawGraph(props) {
	$('#alert').style.display = 'none'
	$('#chart').style.display = null
	$('#chart').setAttribute('viewBox', `0 0 ${props.width} ${props.height}`)

	let shorterAxis = Math.min(props.width, props.height)
	let margin = 1 - (shorterAxis - props.margin) / shorterAxis

	// Calculate the radii's cardinal points.
	let points = calcPoints(1)

	// Note down their extrema for later.
	let pointExtrema = getExtrema(points.map(([x, y]) => [
		props.width/2 +  x,
		props.height/2 + y,
	]))


	// Calculate the axis labels the first time. This way, we can scale the
	// graph data to fit them all.
	let { labelCorners } = calcAxisLabels()

	let labelExtrema = getExtrema(labelCorners)
	let xOver = Math.max(0,
		labelExtrema.right - props.width*(1-margin), props.width*margin - labelExtrema.left)
	let yOver = Math.max(0,
		labelExtrema.bottom - props.height * (1 - margin), props.height*margin - labelExtrema.top)

	let w = props.width/2
	let h = props.height/2

	let xScaleFac = (w-(pointExtrema.left+xOver)) / (h-pointExtrema.left)
	let yScaleFac = (h-(pointExtrema.top +yOver)) / (h-pointExtrema.top )
	let ptScaleFac =  Math.min(xScaleFac, yScaleFac)

	
	points = calcPoints(ptScaleFac * 0.9)

	// If intervals are enabled, draw the polygons that form the web.
	let polys = []
	if (props.intervals !== null) {
		for (let val = props.intervals; val <= props.scale; val += props.intervals) {
			let subPoints = points.map(([x, y]) => [
				props.width / 2 + x * val / props.scale,
				props.height / 2 + y * val / props.scale,
			]).flat().join()
			polys.push(`<polygon class="stroke" points="${subPoints}" />`)
		}
	}

	// Draw the axes.
	let axes = []
	for (let pt of points) {
		axes.push(`<line class="stroke"
			x1="${props.width / 2}"         y1="${props.height / 2}"
			x2="${props.width / 2 + pt[0]}" y2="${props.height / 2 + pt[1]}"
		/>`)
	}

	// Draw the data.
	let data = []
	for (let entry of props.entries) {
		let subPoints = points.map(([x, y], idx) => [
			props.width/2 +  x * entry.data[idx] / props.scale,
			props.height/2 + y * entry.data[idx] / props.scale,
		]).flat().join()
		data.push(`<polygon class="entry" style="
			stroke: ${entry.color}; fill: ${entry.color};
		" points="${subPoints}" />`)
	}

	// If intervals are being used, label them.
	let intLabels = []
	if (props.intervals !== null && !props.hideLabels) {
		const boxPad = 2
		let maxOffset = points[0][1]

		for (let val = 0; val <= props.scale; val += props.intervals) {
			let lblText = props.intLabels[val/props.intervals]
			let boxWidth = measureText(lblText, props.textSize*0.5) + boxPad
			let boxHeight = props.textSize*0.5 + boxPad
			let offset = val / props.scale * maxOffset

			intLabels.push(`
				<rect class="desc-box"
					x="${props.width/2 - boxWidth/2}"
					y="${props.height/2 + offset - boxHeight/2}"
					width="${boxWidth}" height="${boxHeight}"
				/>
				<text class="desc-text"
					x="${props.width/2}"
					y="${props.height/2 + offset + props.textSize*0.25 - boxPad/2}"
				>${lblText}</text>
			`)
		}
	}

	// Recalculate and draw the axis labels.
	points = calcPoints(ptScaleFac)
	let { labels } = calcAxisLabels()

	$('#chart').innerHTML = `
		<style>
			svg {
				background: ${props.background};
				font: ${props.textSize}px sans-serif;
			}
			text {
				text-anchor: middle;
				fill: ${props.textColor};
			}
			.entry {
				fill-opacity: ${props.filledEntries ? 50 : 0}%;
				stroke-width: ${props.entryStrokeWidth};
			}
			.stroke {
				stroke: ${props.strokeColor}; fill: none;
				stroke-width: ${props.mainStrokeWidth};
			}
			.desc-box {
				fill: ${props.intervalBackground};
				stroke: ${props.intervalStrokeColor};
				stroke-width: ${props.mainStrokeWidth};
			}
			.desc-text {
				font-size: ${props.textSize/2}px;
			}
		</style>
		${polys.join('\n')}
		${axes.join('\n')}
		${data.join('\n')}
		${intLabels.join('\n')}
		${labels.join('\n')}
	`

	function calcPoints(fac) {
		let points = []
		let rot = Math.PI / props.numRadii
		if (props.top === 'fr') {
			rot = 0
		} else if (props.top === 'ls') {
			rot *= -1
		}
		for (let rad = 0; rad < 2*Math.PI; rad += 2*Math.PI/props.numRadii) {
			points.push([
				Math.sin(Math.PI-rad + rot) * shorterAxis*fac,
				Math.cos(Math.PI-rad + rot) * shorterAxis*fac,
			])
		}
		return points
	}

	function calcAxisLabels() {
		let labels = []
		let labelCorners = []
		for (let [idx, rdsText] of props.radii.entries()) {
			let corePt = [
				props.width/2 +  points[idx][0],
				props.height/2 + points[idx][1],
			]
			let textDims = [measureText(rdsText, props.textSize), props.textSize]

			// Subtract 0.5 from the Y offset because SVG positions text
			// vertically by their bottom, not their center.
			let resPt = [
				corePt[0] + textDims[0]/2 * (Math.sin(2*Math.PI * idx/props.numRadii)),
				corePt[1] - textDims[1]/2 * (Math.cos(2*Math.PI * idx/props.numRadii)-0.5),
			]

			// Note down the top-left and bottom-right corners for
			// extrema calculation for document rewrapping.
			let subCorners = [
				[resPt[0] - textDims[0]/2, resPt[1] - textDims[1]/2],
				[resPt[0] + textDims[0]/2, resPt[1] + textDims[1]/2],
			]
			labelCorners = labelCorners.concat(subCorners)

			labels.push(`<text x="${resPt[0]}" y="${resPt[1]}">${rdsText}</text>`)
		}
		return { labels, labelCorners }
	}

	function measureText(text, size) {
		let measure = $('#text-measure')
		measure.style.fontSize = `${size}px`
		measure.innerText = text
		return measure.offsetWidth
	}

	function getExtrema(points) {
		let xVals = points.map(([x, _y]) => x)
		let yVals = points.map(([_x, y]) => y)
		return {
			left: Math.min(...xVals),
			right: Math.max(...xVals),
			top: Math.min(...yVals),
			bottom: Math.max(...yVals),
		}
	}
}

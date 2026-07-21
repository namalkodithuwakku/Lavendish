/************************************************************
 * N K Hotels - Lavendish Occupancy Reader
 * READ ONLY: this file contains no Sheet write operations.
 ************************************************************/

var ROW_ALIASES_ = {
  TOTAL: ["total", "grand total", "total sold", "total rooms sold", "rooms sold total", "total occupied", "total occupancy"],
  AVAILABILITY: ["balance room", "balance rooms", "room balance", "rooms balance", "available room", "available rooms", "room availability", "total availability", "total available", "total balance", "tolat balance", "balance"],
  FUNCTIONS: ["function", "functions", "function rooms", "functions rooms", "funtion", "funtions", "funcion", "funcions"],
  ALLOTMENT: ["allotment", "allotments", "room allotment", "allotted rooms", "allowment", "allowments", "alloment", "alotment"]
};
var HEADER_ALIASES_ = {
  TOTAL_ROOMS: ["total rooms", "total room", "number of rooms", "no of rooms", "no. of rooms", "room count", "rooms"],
  LAST_UPDATED: ["last updated date", "last update date", "last updated", "updated date", "update date", "last update"],
  TIME: ["time", "updated time", "last updated time", "update time"]
};
var MONTH_NAMES_ = ["january","february","march","april","may","june","july","august","september","october","november","december"];
var MONTH_SHORT_ = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    validateToken_(p.token);
    var action = String(p.action || "read").toLowerCase();
    if (action === "health") return json_({ success: true, service: "occupancy-reader", mode: "read-only" });
    if (action !== "read") throw new Error("Unsupported action");
    return json_(readOccupancy_(String(p.sheetId || ""), String(p.year || ""), Number(p.month || 0)));
  } catch (error) {
    return json_({ success: false, error: error && error.message ? error.message : String(error) });
  }
}

function readOccupancy_(sheetId, requestedYear, requestedMonth) {
  if (!/^[a-zA-Z0-9-_]{20,}$/.test(sheetId)) throw new Error("Invalid Google Spreadsheet ID");
  var now = new Date();
  var year = requestedYear || String(now.getFullYear());
  var month = requestedMonth >= 1 && requestedMonth <= 12 ? requestedMonth : now.getMonth() + 1;
  var book = SpreadsheetApp.openById(sheetId);
  var sheet = findYearSheet_(book, year);
  if (!sheet) throw new Error("Year tab not found: " + year);
  var range = sheet.getDataRange();
  var values = range.getValues();
  var display = range.getDisplayValues();
  var block = findMonthBlock_(values, display, month);
  var parsed = parseMonthBlock_(values, display, block.start, block.end, month);
  return {
    success: true,
    spreadsheetId: sheetId,
    spreadsheetName: book.getName(),
    year: year,
    month: month,
    tabName: sheet.getName(),
    hotelName: parsed.hotelName,
    totalRooms: parsed.totalRooms,
    lastUpdatedDate: parsed.lastUpdatedDate,
    lastUpdatedTime: parsed.lastUpdatedTime,
    days: parsed.days,
    sources: parsed.sources,
    dailySources: parsed.dailySources,
    functions: parsed.functions,
    allotment: parsed.allotment,
    availability: parsed.availability,
    warnings: parsed.warnings,
    readAt: new Date().toISOString(),
    mode: "read-only"
  };
}

function findMonthBlock_(values, display, month) {
  var target = MONTH_NAMES_[month - 1];
  var starts = [];
  for (var r = 0; r < values.length; r++) {
    var foundMonth = false;
    for (var c = 0; c < Math.min(values[r].length, 8); c++) {
      if (monthNumber_(values[r][c], display[r][c]) === month) foundMonth = true;
    }
    if (foundMonth && rowContainsAlias_(display[r], "TOTAL_ROOMS", HEADER_ALIASES_)) starts.push(r);
  }
  if (!starts.length) throw new Error("Month block not found: " + target);
  var start = starts[0];
  var end = values.length;
  for (var x = start + 1; x < values.length; x++) {
    if (rowContainsAlias_(display[x], "TOTAL_ROOMS", HEADER_ALIASES_) && isMonthHeaderRow_(values[x], display[x])) { end = x; break; }
  }
  return { start: start, end: end };
}

function parseMonthBlock_(values, display, start, end, month) {
  var header = display[start];
  var totalRooms = numberRightOfAlias_(values[start], display[start], "TOTAL_ROOMS");
  var hotelName = findHotelName_(header, month);
  var lastUpdatedDate = textRightOfAlias_(display[start], "LAST_UPDATED");
  var lastUpdatedTime = textRightOfAlias_(display[start], "TIME");
  var dateRow = -1;
  var dateColumns = {};
  for (var r = start + 1; r < Math.min(end, start + 8); r++) {
    var count = 0;
    for (var c = 0; c < values[r].length; c++) {
      var n = toDayNumber_(values[r][c], display[r][c]);
      if (n >= 1 && n <= 31) { dateColumns[n] = c; count++; }
    }
    if (count >= 20) { dateRow = r; break; }
    dateColumns = {};
  }
  if (dateRow < 0) throw new Error("Date columns were not identified");

  var totalRow = -1, functionsRows = [], allotmentRows = [], availabilityRow = -1;
  for (var i = dateRow + 1; i < end; i++) {
    var label = firstLabel_(display[i]);
    var key = canonicalLabel_(label);
    if (key === "TOTAL" && totalRow < 0) totalRow = i;
    if (key === "FUNCTIONS") functionsRows.push(i);
    if (key === "ALLOTMENT") allotmentRows.push(i);
    if (key === "AVAILABILITY" && availabilityRow < 0) availabilityRow = i;
  }
  if (totalRow < 0) throw new Error("Total row was not identified");

  var days = [], warnings = [], sourceMap = {};
  for (var day = 1; day <= 31; day++) {
    if (dateColumns[day] === undefined) continue;
    var occupied = numeric_(values[totalRow][dateColumns[day]]);
    var available = totalRooms === null ? null : totalRooms - occupied;
    if (available !== null && available < 0) warnings.push("Over capacity on day " + day + " by " + Math.abs(available) + " rooms");
    days.push({ day: day, occupied: occupied, available: available, occupancyPercent: totalRooms ? Math.round(occupied / totalRooms * 100) : null });
  }

  // Only rows above Total are booking sources. Rows below Total such as
  // Balance Rooms and Functions must never enter the source breakdown.
  for (var sr = dateRow + 1; sr < totalRow; sr++) {
    var sourceName = firstLabel_(display[sr]);
    if (!sourceName) continue;
    var sourceKey = canonicalLabel_(sourceName);
    if (["FUNCTIONS","ALLOTMENT","AVAILABILITY"].indexOf(sourceKey) >= 0) continue;
    var sourceTotal = sumDateColumns_(values[sr], dateColumns);
    var sourceDays = dateSeries_(values[sr], dateColumns);
    var mapKey = normalize_(sourceName);
    if (!sourceMap[mapKey]) {
      sourceMap[mapKey] = { name: sourceName.trim(), rooms: 0, days: sourceDays };
    }
    sourceMap[mapKey].rooms += sourceTotal;
  }

  var sourceList = Object.keys(sourceMap).map(function(k){ return sourceMap[k]; }).filter(function(source){
    return source.rooms !== 0 || source.days.some(function(entry){ return entry.rooms !== 0; });
  });
  var dailySources = days.map(function(dayEntry){
    return {
      day: dayEntry.day,
      rooms: sourceList.map(function(source){
        var entry = source.days.filter(function(item){ return item.day === dayEntry.day; })[0];
        return { name: source.name, rooms: entry ? numeric_(entry.rooms) : 0 };
      }).filter(function(source){ return source.rooms !== 0; })
    };
  });

  return {
    hotelName: hotelName,
    totalRooms: totalRooms,
    lastUpdatedDate: lastUpdatedDate,
    lastUpdatedTime: lastUpdatedTime,
    days: days,
    sources: sourceList,
    dailySources: dailySources,
    functions: sumRows_(values, functionsRows, dateColumns),
    allotment: sumRows_(values, allotmentRows, dateColumns),
    availability: availabilityRow >= 0 ? dateSeries_(values[availabilityRow], dateColumns) : days.map(function(d){ return { day:d.day, rooms:d.available }; }),
    warnings: warnings
  };
}

function canonicalLabel_(label) {
  if (matchesAlias_(label, "TOTAL", ROW_ALIASES_)) return "TOTAL";
  if (matchesAlias_(label, "AVAILABILITY", ROW_ALIASES_)) return "AVAILABILITY";
  if (matchesAlias_(label, "FUNCTIONS", ROW_ALIASES_)) return "FUNCTIONS";
  if (matchesAlias_(label, "ALLOTMENT", ROW_ALIASES_)) return "ALLOTMENT";
  return "SOURCE";
}

function normalize_(value) { return String(value == null ? "" : value).trim().toLowerCase().replace(/&/g," and ").replace(/[()\[\]{}:;,.\/_-]+/g," ").replace(/\s+/g," ").trim(); }
function findYearSheet_(book, year) { var exact=book.getSheetByName(year); if(exact) return exact; var target=normalize_(year); var sheets=book.getSheets(); for(var i=0;i<sheets.length;i++){var name=normalize_(sheets[i].getName());if(name===target||name==="year "+target||name===target+" year"||name.indexOf(target)!==-1) return sheets[i];} return null; }
function matchesAlias_(value,key,map) { var n=normalize_(value),list=map[key]||[]; for(var i=0;i<list.length;i++) if(n===normalize_(list[i])) return true; return false; }
function rowContainsAlias_(row,key,map) { return row.some(function(value){return matchesAlias_(value,key,map);}); }
function monthNumber_(raw,shown) { if(raw instanceof Date&&raw.getDate()===1) return raw.getMonth()+1; var n=normalize_(shown).replace(/\b(19|20)\d{2}\b/g,"").trim(); for(var i=0;i<12;i++) if(n===MONTH_NAMES_[i]||n===MONTH_SHORT_[i]||n.indexOf(MONTH_NAMES_[i]+" ")===0||n.indexOf(MONTH_SHORT_[i]+" ")===0) return i+1; return 0; }
function rowContains_(row, text) { var target=normalize_(text); return row.some(function(v){ return normalize_(v) === target; }); }
function isMonthHeaderRow_(raw, shown) { for(var i=0;i<raw.length;i++) if(monthNumber_(raw[i],shown[i])>0) return true; return false; }
function firstLabel_(row) { for (var c=0;c<row.length;c++) if (String(row[c]).trim()) return String(row[c]).trim(); return ""; }
function numeric_(v) { var n=Number(v); return isFinite(n)?n:0; }
function toDayNumber_(raw, shown) { if (typeof raw === "number" && raw>=1 && raw<=31) return Math.floor(raw); var n=Number(String(shown).trim()); return isFinite(n)?Math.floor(n):0; }
function sumDateColumns_(row, cols) { return Object.keys(cols).reduce(function(sum,d){ return sum + numeric_(row[cols[d]]); },0); }
function sumRows_(values, rows, cols) { return rows.reduce(function(sum,r){ return sum + sumDateColumns_(values[r],cols); },0); }
function dateSeries_(row, cols) { return Object.keys(cols).map(function(d){ return {day:Number(d),rooms:numeric_(row[cols[d]])}; }); }
function numberRightOfAlias_(raw,shown,key) { for(var c=0;c<shown.length;c++) if(matchesAlias_(shown[c],key,HEADER_ALIASES_)) for(var x=c+1;x<shown.length;x++) if(raw[x]!==""&&raw[x]!=null&&!isNaN(Number(raw[x]))) return Number(raw[x]); return null; }
function textRightOfAlias_(row,key) { for(var c=0;c<row.length;c++) if(matchesAlias_(row[c],key,HEADER_ALIASES_)) for(var x=c+1;x<row.length;x++) if(String(row[x]).trim()) return String(row[x]).trim(); return ""; }
function findHotelName_(row,month) { for(var c=0;c<row.length;c++){var n=normalize_(row[c]);if(n&&monthNumber_(row[c],row[c])!==month&&!matchesAlias_(row[c],"TOTAL_ROOMS",HEADER_ALIASES_)&&!matchesAlias_(row[c],"LAST_UPDATED",HEADER_ALIASES_)&&!matchesAlias_(row[c],"TIME",HEADER_ALIASES_)&&!/^\d/.test(n)) return String(row[c]).trim();} return ""; }
function validateToken_(provided) { var expected=PropertiesService.getScriptProperties().getProperty("OCCUPANCY_API_TOKEN"); if(!expected) throw new Error("Reader token is not configured"); if(String(provided||"")!==expected) throw new Error("Unauthorized"); }
function json_(payload) { return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON); }

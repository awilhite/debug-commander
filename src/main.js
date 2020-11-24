/*----- Includes -----*/
const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const { once, EventEmitter } = require("events");
const SerialPort = require("serialport");
const commandFunctions = require(path.resolve(
  __dirname,
  "commandFunctions.js"
));
const utils = require(path.resolve(__dirname, "utils.js"));
const Ready = SerialPort.parsers.Ready;

const settings = {
  COMMAND_TIMEOUT_MS: 5000,
  /* FTDI Cable Product and Vendor ID */
  FTDI_CABLE_PID: "6001",
  FTDI_CABLE_VID: "0403",
  COMMAND_EXECUTION_INTERVAL_MS: 500,
  DEBUG_BAUD_RATE: 115200,
  OUTPUT_FILE_NAME_SUFFIX: "_Debug_Output.txt",
  COMMAND_LIST_FILE: "../files/commandList.txt",
  COMMAND_SEQUENCE_FILE: "../files/commandSequence.txt",
  OUTPUT_DIRECTORY: "../output",
};

/*----- Constants ------*/
const ee = new EventEmitter();
const stdInput = process.stdin;

const COM_PORT_STATES = {
  COM_PORT_STATE_CLOSED: 0,
  COM_PORT_STATE_OPEN: 1,
};

const APP_EVENTS = {
  EVENT_USER_INPUT: 0,
  EVENT_TIMER_EXPIRED: 1,
  EVENT_COM_PORT_CLOSED: 2,
  EVENT_STATE_ENTER_COMPLETE: 3,
};

/*----- Variables -----*/

var app = {};

/*----- Initialization -----*/

function initAppVariables() {
  app.comPortState = COM_PORT_STATES.COM_PORT_STATE_CLOSED;
  app.allOutput = "";
  app.comPort = null;
  app.commandListFile = app.sequenceList = [];
  app.commandList = [];
  /* CommandList and SequenceList use zero-based indexing */
  app.sequenceCounter = 0;
  app.intervalTimer = null;
}

/*----- Function Definitions -----*/

async function getPortList() {
  return new Promise(function (resolve, reject) {
    SerialPort.list(function (err, ports) {
      if (err) {
        reject(err);
      }

      var result = { best: "", ports: [] };
      var highest = 0;

      for (var i = 0; i < ports.length; i++) {
        var port = ports[i];

        /* If this port name does not start with COM, skip it */
        if (port.comName.substring(0, 3) !== "COM") {
          continue;
        }
        /* If the number after COM is less than 3, skip it.  COM1 and COM2 are
         * not USB */
        if (parseInt(port.comName.substring(3)) < 3) {
          continue;
        }

        /* This is a possible port. */
        result.ports.push(port.comName);

        /* The best port is the one that identifies as an FTDI chip and has
        the highest COM number.  This is most likely to be the one we want
        to connect to */
        if (
          port.productId === settings.FTDI_CABLE_PID &&
          port.vendorId === settings.FTDI_CABLE_VID
        ) {
          if (parseInt(port.comName.substring(3)) > highest) {
            result.best = port.comName;
            highest = parseInt(port.comName.substring(3));
          }
        }
      }

      result.ports.sort(function (a, b) {
        return parseInt(a.substring(3)) - parseInt(b.substring(3));
      });

      if (result.best === "" && result.ports.length !== 0) {
        result.best = result.ports[result.ports.length - 1];
      }

      resolve(result);
    });
  });
}

function readFile(fileName) {
  return new Promise(function (resolve, reject) {
    fs.readFile(path.join(__dirname, fileName), "utf8", function (
      err,
      fileData
    ) {
      if (err) {
        reject(err);
      }
      resolve(fileData);
    });
  });
}

function writeFile(fileName, fileData) {
  return new Promise(function (resolve, reject) {
    fs.writeFile(path.join(__dirname, fileName), fileData, "utf8", function (
      err
    ) {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
}

let tempBuffer;

async function registerComPortEvents() {
  app.comPort.on("data", function (data) {
    let stringData = data.toString();
    tempBuffer += stringData;
    app.allOutput += stringData;
    if (tempBuffer.includes("\r\n")) {
      let replyLines = tempBuffer.split("\r\n");

      if (replyLines[replyLines.length - 1] != "") {
        tempBuffer = replyLines.slice(-1)[0];
        //console.log(tempBuffer);
      }
      /* Remove the last list item in either case */
      replyLines = replyLines.slice(0, replyLines.length - 1);

      for (let replyLine of replyLines) {
        ee.emit("reply", replyLine);
      }
    }
  });

  app.comPort.on("close", function () {
    console.warn("Port closed");
    app.comPortState = COM_PORT_STATES.COM_PORT_STATE_CLOSED;
    signalEvent(APP_EVENTS.EVENT_COM_PORT_CLOSED);
  });

  app.comPort.on("error", function (err) {
    console.error(err.message);
  });
}

function openCOMPort(comPortName) {
  return new Promise(function (resolve, reject) {
    app.comPort = new SerialPort(
      comPortName,
      { baudRate: settings.DEBUG_BAUD_RATE },
      function (err) {
        if (err) {
          reject(err);
        }
        app.comPortState = COM_PORT_STATES.COM_PORT_STATE_OPEN;

        resolve(app.comPort);
      }
    );
  });
}

function parseCommandList(fileData) {
  function splitCommand(item) {
    var commandSplit = item.split(" ");
    /* Remove optional line numbering if present */
    if (!isNaN(parseInt(commandSplit[0]))) {
      commandSplit = commandSplit.slice(1);
    }
    var command = commandSplit.join(" ");

    return command;
  }

  var commandList = fileData.split("\r\n");
  return commandList.map(splitCommand);
}

function parseCommandSequence(fileData) {
  var sequenceList = fileData.split("\r\n");

  if (sequenceList[sequenceList.length - 1] === "") {
    sequenceList = sequenceList.slice(0, sequenceList.length - 1);
  }

  return sequenceList;
}

async function loadSequence() {
  /* TODO: make sequence optional */
  /* let inputs = process.argv.slice(2);
        if (inputs.length == 2) {
        
    }*/

  let commandListFile = await readFile(settings.COMMAND_LIST_FILE);
  app.commandList = parseCommandList(commandListFile);

  let sequnceList = await readFile(settings.COMMAND_SEQUENCE_FILE);
  app.sequenceList = parseCommandSequence(sequnceList);
  //console.log(app.sequenceList);
}

async function handleExecuteCommand(currentCommand) {
  const EQUAL_TO_OPERATOR = ":";
  const REGEX_OPERATOR = "|";

  //console.log("handleExecuteCommand", currentCommand);

  let operator;
  if (currentCommand.includes(REGEX_OPERATOR)) {
    operator = REGEX_OPERATOR;
  } else if (currentCommand.includes(EQUAL_TO_OPERATOR)) {
    operator = EQUAL_TO_OPERATOR;
  }

  let splitCommandResponse = currentCommand.split(operator);

  let expectedResponse = splitCommandResponse[1];
  let commandString = splitCommandResponse[0].replace("~", "").split(" ");
  let funcName = commandString[0];
  let cmdParams = commandString.slice(1);

  let funcObj = commandFunctions[funcName];
  let result = await funcObj.func.apply(null, cmdParams);
  if (funcObj.formatResponse) {
    result = funcObj.formatResponse(result);
  }

  //console.log("Execute", funcName, cmdParams, result);

  if (operator == REGEX_OPERATOR) {
    try {
      let pattern = expectedResponse.trim();
      let regex = new RegExp(pattern);

      let response = result.match(regex);
      //console.log(response);

      for (varName in response.groups) {
        //console.log(varName, "=", response.groups[varName]);
        app[varName] = response.groups[varName];
      }
      return true;
    } catch {
      return false;
    }
  } else if (operator == EQUAL_TO_OPERATOR) {
    if (expectedResponse == result) {
      return true;
    } else {
      return false;
    }
  }
}

function collect(emitter, event, count) {
  const results = [];

  return new Promise((resolve, reject) => {
    emitter.on(event, (value) => {
      results.push(value);
      if (results.length === count) {
        return resolve(results);
      }
    });
  });
}

function resolveIfEventMatch(emitter, event, regex) {
  const results = [];

  return new Promise((resolve, reject) => {
    emitter.on(event, (value) => {
      let match = value.match(regex);
      if (match !== null) {
        resolve(match);
      }
    });
  });
}

async function waitForReplyCountTimeout(count) {
  let possibleResults = [];

  let commandTimeout = utils.waitReject(1000);
  possibleResults.push(commandTimeout);
  let commandResponse = collect(ee, "reply", count);
  possibleResults.push(commandResponse);

  let result = await Promise.race(possibleResults);
  return result;
}

async function waitForReplyMatchTimeout(regex) {
  let possibleResults = [];

  let commandTimeout = utils.waitReject(settings.COMMAND_TIMEOUT_MS);
  possibleResults.push(commandTimeout);
  let commandResponse = resolveIfEventMatch(ee, "reply", regex);
  possibleResults.push(commandResponse);

  let result = await Promise.race(possibleResults);
  return result;
}

function handleVarCompareCommand(currentCommand) {
  const EQUAL_TO_OPERATOR = ":";
  const REGEX_OPERATOR = "|";

  //console.log("handleVarCompareCommand");

  let operator;
  if (currentCommand.includes(REGEX_OPERATOR)) {
    operator = REGEX_OPERATOR;
  } else if (currentCommand.includes(EQUAL_TO_OPERATOR)) {
    operator = EQUAL_TO_OPERATOR;
  }

  let splitCommandResponse = currentCommand.split(operator);

  let expectedResponse = splitCommandResponse[1];
  let commandString = splitCommandResponse[0].replace("^", "");

  const VARIABLE_PATTERN = /\$\{(?<varName>.+)\}/;

  let match = commandString.match(VARIABLE_PATTERN);
  //console.log(match);
  if (match.groups) {
    if (match.groups.varName) {
      let varValue = app[match.groups.varName];

      try {
        let pattern = expectedResponse.trim();
        let regex = new RegExp(pattern);

        let response = varValue.match(regex);
        if (response !== null) {
          return true;
        }
      } catch {
        return false;
      }
    }
  }
}

async function handleComparisonCommand(currentCommand) {
  /* Comparison */
  const BETWEEN_OPERATOR = "><";
  const EQUAL_TO_OPERATOR = "==";
  const REGEX_OPERATOR = "|";

  if (currentCommand.includes(BETWEEN_OPERATOR)) {
    operator = BETWEEN_OPERATOR;
  } else if (currentCommand.includes(EQUAL_TO_OPERATOR)) {
    operator = EQUAL_TO_OPERATOR;
  } else if (currentCommand.includes(REGEX_OPERATOR)) {
    operator = REGEX_OPERATOR;
  } else {
    console.error("Unsupported comparison");
  }

  let splitCommand = currentCommand.split(operator);
  let serialCommand = splitCommand[0];
  let lineCountExpectedResponse = splitCommand[1];

  if (operator == REGEX_OPERATOR) {
    app.comPort.write(serialCommand.concat("\r\n"));

    try {
      let pattern = lineCountExpectedResponse.trim();
      let regex = new RegExp(pattern);
      let response = await waitForReplyMatchTimeout(regex);
      for (varName in response.groups) {
        //console.log(varName, "=", response.groups[varName]);
        app[varName] = response.groups[varName];
      }
      console.log("\tSUCCESS");
      return true;
    } catch {
      console.error("\tFAIL: Command timeout");
      return false;
    }
  } else {
    let regex = /\((\d+)\)(.+)/;
    let matchResult = lineCountExpectedResponse.match(regex);
    if (matchResult.length != 3) {
      console.error("Invalid command format");
      return;
    }

    let lineCount = parseInt(matchResult[1], 10);

    let expectedResponse = matchResult[2];
    console.log(expectedResponse);
    app.comPort.write(serialCommand.concat("\r\n"));

    let response = await waitForReplyCountTimeout(lineCount);
    if (operator == EQUAL_TO_OPERATOR) {
      if (response.includes(expectedResponse)) {
        console.log("\tSUCCESS");
        return true;
      }
    } else if (operator == BETWEEN_OPERATOR) {
      //console.log(response);
      if (response.length != 1) {
        console.error("Too many responses");
        return false;
      }

      let arrayRegex = /\[(.+)\]/;
      let responseArray = expectedResponse.match(arrayRegex);
      if (responseArray.length != 2) {
        console.error("Invalid command format");
        return false;
      }
      responseArray = responseArray[1].split(",");
      //console.log(responseArray);
      if (
        response > responseArray[0].trim() &&
        response < responseArray[1].trim()
      ) {
        console.log("SUCCESS");
        return true;
      }
    }
  }
}

async function runSequence() {
  let nextState = app.state;

  let commandMap = {
    CMD_COMPARISON: "=",
    CMD_PRINT_CONTINUE: "##",
    CMD_EXECUTE: "~",
    CMD_PRINT: "#",
    CMD_VAR_COMPARE: "^",
    CMD_SIMPLE: "",
    CMD_INVALID: "-1",
  };

  let commandType;

  //console.log(app.sequenceCounter, app.sequenceList.length);

  if (app.sequenceCounter == app.sequenceList.length) {
    nextState = AppState_SEQUENCE_COMPLETE;
    return nextState;
  }

  var currentSequence = app.sequenceList[app.sequenceCounter];
  //console.log("Event Number:", app.sequenceCounter);

  if (isNaN(currentSequence)) {
    console.error("Invalid sequence:", currentSequence);
    return nextState;
  }

  currentSequence = parseInt(currentSequence);

  var currentCommand = app.commandList[currentSequence];

  if (currentCommand === "") {
    commandType = commandMap.CMD_INVALID;
  }

  /* Determine the command type */
  if (currentCommand.startsWith(commandMap.CMD_PRINT_CONTINUE)) {
    commandType = commandMap.CMD_PRINT_CONTINUE;
  } else if (currentCommand.startsWith(commandMap.CMD_PRINT)) {
    commandType = commandMap.CMD_PRINT;
  } else if (currentCommand.startsWith(commandMap.CMD_EXECUTE)) {
    commandType = commandMap.CMD_EXECUTE;
  } else if (currentCommand.startsWith(commandMap.CMD_COMPARISON)) {
    commandType = commandMap.CMD_COMPARISON;
  } else if (currentCommand.startsWith(commandMap.CMD_VAR_COMPARE)) {
    commandType = commandMap.CMD_VAR_COMPARE;
  } else {
    commandType = commandMap.CMD_SIMPLE;
  }

  if (commandType != commandMap.CMD_VAR_COMPARE) {
    const VARIABLE_PATTERN = /\$\{(?<var>\w+)\}/g;

    currentCommand = currentCommand.replace(VARIABLE_PATTERN, (...args) => {
      //console.log(args);
      let lastArg = args[args.length - 1];
      if (lastArg.var) {
        return app[lastArg.var];
      }
      return args[0];
    });
  }

  switch (commandType) {
    case commandMap.CMD_PRINT_CONTINUE: {
      /* Pause execution */
      app.sequenceCounter = app.sequenceCounter + 1;

      console.log(
        currentCommand
          .replace(commandMap.CMD_PRINT_CONTINUE, "")
          .concat(" then press any key to continue")
      );

      nextState = AppState_WAIT_FOR_CONTINUE;
      break;
    }
    case commandMap.CMD_PRINT: {
      /* Log message */
      //console.log("commandMap.CMD_PRINT");
      app.sequenceCounter = app.sequenceCounter + 1;
      console.log(currentCommand.replace(commandMap.CMD_PRINT, ""));
      break;
    }
    case commandMap.CMD_EXECUTE: {
      /* Execute function */
      let success = await handleExecuteCommand(currentCommand);
      if (success) {
        app.sequenceCounter = app.sequenceCounter + 1;
      } else {
        console.log("\tFAIL");
        nextState = AppState_SEQUENCE_COMPLETE;
      }
      break;
    }
    case commandMap.CMD_COMPARISON: {
      /* Execute function */
      currentCommand = currentCommand.replace(commandMap.CMD_COMPARISON, "");
      let success = await handleComparisonCommand(currentCommand);
      if (success) {
        app.sequenceCounter = app.sequenceCounter + 1;
      } else {
        console.log("\tFAIL");
        nextState = AppState_SEQUENCE_COMPLETE;
      }
      break;
    }
    case commandMap.CMD_INVALID: {
      console.error("Invalid command:", currentCommand);
      break;
    }
    case commandMap.CMD_SIMPLE: {
      app.comPort.write(currentCommand.concat("\r\n"));
      app.sequenceCounter = app.sequenceCounter + 1;
      break;
    }
    case commandMap.CMD_VAR_COMPARE: {
      let success = handleVarCompareCommand(currentCommand);
      if (success) {
        console.log("\tSUCCESS");
      } else {
        console.log("\tFAIL");
      }
      app.sequenceCounter = app.sequenceCounter + 1;
      break;
    }
    default: {
      console.log("Unhandled command");
    }
  }

  return nextState;
}

function printFileName(fileName) {
  console.log("Processed", fileName);
}

async function setState(state) {
  if (state == undefined) {
    console.error("State is undefined");
    return;
  }

  if (state != app.state) {
    app.state = state;
    if (state.enter) {
      await state.enter();
      signalEvent(APP_EVENTS.EVENT_STATE_ENTER_COMPLETE);
    }
  }
}

async function signalEvent(eventType, eventData) {
  //console.log(eventType, eventData);

  try {
    let { furtherProcessingNeeded, nextState } = handleEventForAllStates(
      eventType,
      eventData
    );

    if (nextState) {
      await setState(nextState);
    }

    if (furtherProcessingNeeded) {
      let nextState = await handleEventPerState(
        app.state,
        eventType,
        eventData
      );
      if (nextState != undefined) {
        await setState(nextState);
      }
    }
  } catch (err) {
    console.log(err);
    await setState(AppState_SEQUENCE_COMPLETE);
  }
}

/** States */

const AppState_INIT = {
  name: "AppState_INIT",
  enter: async () => {
    initAppVariables();

    return getPortList()
      .then(function (result) {
        console.log("Please type your COM port selection:");
        result.ports.forEach((item) => console.log(item));
      })
      .catch(function (err) {
        console.error(err);
      });
  },
  handleEvent: (eventType) => {
    if (eventType == APP_EVENTS.EVENT_STATE_ENTER_COMPLETE) {
      return AppState_WAIT_FOR_COM_PORT;
    }

    return AppState_INIT;
  },
};

const AppState_WAIT_FOR_COM_PORT = {
  name: "AppState_WAIT_FOR_COM_PORT",
  handleEvent: async (eventType, eventData) => {
    if (eventType === APP_EVENTS.EVENT_USER_INPUT) {
      var comPortName = eventData.trim();

      return openCOMPort(comPortName)
        .then(registerComPortEvents)
        .then(function () {
          console.log("Opened", comPortName);
          console.log("Press any key to start the sequence");
          return AppState_WAIT_FOR_START;
        })
        .catch(function (err) {
          console.error(err);
        });
    }

    return AppState_WAIT_FOR_COM_PORT;
  },
};

const AppState_WAIT_FOR_START = {
  name: "AppState_WAIT_FOR_START",
  handleEvent: (eventType) => {
    if (eventType === APP_EVENTS.EVENT_USER_INPUT) {
      return AppState_RUNNING_SEQUENCE;
    }

    return AppState_WAIT_FOR_START;
  },
};

const AppState_RUNNING_SEQUENCE = {
  name: "AppState_RUNNING_SEQUENCE",
  enter: async () => {
    if (!app.intervalTimer) {
      await loadSequence();

      /* Start the periodic timer to run the remaining items */
      app.intervalTimer = setInterval(function () {
        signalEvent(APP_EVENTS.EVENT_TIMER_EXPIRED);
      }, settings.COMMAND_EXECUTION_INTERVAL_MS);

      /* Send event to complete the first item in the sequence */
      signalEvent(APP_EVENTS.EVENT_TIMER_EXPIRED);
    }
  },
  handleEvent: async (eventType) => {
    let nextState = AppState_RUNNING_SEQUENCE;
    if (eventType === APP_EVENTS.EVENT_TIMER_EXPIRED) {
      clearInterval(app.intervalTimer);
      nextState = await runSequence();
      app.intervalTimer = setInterval(function () {
        signalEvent(APP_EVENTS.EVENT_TIMER_EXPIRED);
      }, settings.COMMAND_EXECUTION_INTERVAL_MS);
    }

    return nextState;
  },
};

const AppState_WAIT_FOR_CONTINUE = {
  name: "AppState_WAIT_FOR_CONTINUE",
  handleEvent: (eventType) => {
    if (eventType === APP_EVENTS.EVENT_USER_INPUT) {
      return AppState_RUNNING_SEQUENCE;
    }

    return AppState_WAIT_FOR_CONTINUE;
  },
};

const AppState_SEQUENCE_COMPLETE = {
  name: "AppState_SEQUENCE_COMPLETE",
  handleEvent: async (eventType) => {
    if (eventType === APP_EVENTS.EVENT_TIMER_EXPIRED) {
      clearInterval(app.intervalTimer);
      if (!app.fileName) {
        var date = new Date();
        app.fileName = "".concat(
          date.getFullYear().toString().padStart(4, "0"),
          (date.getMonth() + 1).toString().padStart(2, "0"),
          date.getDate().toString().padStart(2, "0"),
          settings.OUTPUT_FILE_NAME_SUFFIX
        );
      } else {
        app.fileName = app.fileName.concat(settings.OUTPUT_FILE_NAME_SUFFIX);
      }
      app.fileName = path.join(settings.OUTPUT_DIRECTORY, app.fileName);

      /* Write the output file */
      await writeFile(app.fileName, app.allOutput);

      console.log("Sequence Complete");
      app.comPort.close();
      process.exit(0);
    }

    return AppState_SEQUENCE_COMPLETE;
  },
};

/**
 * Processes the event for all states
 * @param {*} eventType
 * @param {*} eventData
 */
function handleEventForAllStates(eventType, eventData) {
  let returnObj = {
    furtherProcessingNeeded: false,
    nextState: null,
  };

  if (eventType === APP_EVENTS.EVENT_COM_PORT_CLOSED) {
    /* Handle COM port closing the same in all states */
    clearInterval(app.intervalTimer);
    returnObj.nextState = AppState_STATE_INIT;
  } else {
    returnObj.furtherProcessingNeeded = true;
  }

  return returnObj;
}

/**
 * Process the event for the current state
 * @param {*} appState
 * @param {*} eventType
 * @param {*} eventData
 */
async function handleEventPerState(appState, eventType, eventData) {
  //console.log("State:", app.state.name, "Event type:", eventType, "EventData:", eventData);

  return appState.handleEvent(eventType, eventData);
}

/*----- Application -----*/

stdInput.setEncoding("utf-8");
initAppVariables();
setState(AppState_INIT);

/*----- Event Handlers -----*/

function _inputHandler(data) {
  signalEvent(APP_EVENTS.EVENT_USER_INPUT, data);
}

stdInput.on("data", _inputHandler);

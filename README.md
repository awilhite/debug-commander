# Debug Commander Utility

This NodeJS script issues a list of serial commands to a target device for automated testing.

The list and sequence of serial commands are defined by the commandList.txt and commandSequence.txt files, respectively.

[TOC]

## Document Change Notes
| Rev  | Description                        | Date       | Changed By |
| -- | ---------------------------------- | ---------- | ---------- |
| 1   | Initial release                    | 11/4/2020 | A. Wilhite |

## Software Requirements

 - Python 2.7.x: https://www.python.org/downloads/windows/
 - NodeJS Version 10.23.0
     - Download from https://nodejs.org/en/download/releases/
     - OR install via Node Version Manager for Windows: https://github.com/coreybutler/nvm-windows

## Installation

Navigate to the application directory and run

```
npm install
```

Usage
-------------------------------------------------

### Running the Script

Navigate to the application directory and run the following in a command prompt

```
npm run start
```

### Default Settings

The following settings are selected by default. these settings can be changed by modifying the appropriate constant in the ```settings``` object.

- The default baud rate is ```115200```
- Each command will wait up to ```5 seconds``` for a successful response before a timeout failure
- An output file for each test execution will be stored in the ```output``` directory

### Command List

The ```commandList.txt``` file contains a list of defined commands that can be executed.

#### Types of Commands

##### Print Command

Lines starting with ```#``` print the message that follows```#```.

##### Print Wait Command

Lines starting with ```##``` print the message that follows ```##``` and pause execution to wait for user input.

##### Function Execution Commands

Lines starting with ```~``` will execute the respective function in ```commandFunctions.js.```

- Arguments can be supplied to the function by following the function name with a space-separated list

- The result of the function will be compared to either a fixed value or a regular expression
  - Fixed values are separated from the arguments by a ```:```
  - Regular expressions are separated from the arguments by a ```|```
  
- The raw result of the function can be modified with a function assigned to the ```formatResponse``` attribute in ```commandFunctions.js```

Example:

Function to execute: ping
Argument: 192.168.1.1
Expected response: true

```
~ping 192.168.1.1:true  
```

##### Comparison Command

This command begins with "=". This type of command will issue a serial command and then check for an expected response using a regular expression.

Example:
```
=GET_PAIRING_NAME|Pairing name: (?<fileName>.+)
```

##### Variable Comparison Command

This command begins with ```^```. This type of command will compare the value of a stored variable to a regular expression.

Example:

```
^${diff}|\d
```

##### Simple Commands

All other lines are send directly via the serial port to the target device.

Example:

```
LED green
```

### Command Sequence

The ```commandSequence.txt``` file lists the order in which the commands listed in ```commandList.txt``` should be executed.


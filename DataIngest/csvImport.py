'''
Finance Tool data ingest function

takes a csv and parses the data into a map of all the given values with the column labels as keys

Developed by Elliot Warren and Ramy Wong
'''

import csv

# Read CSV file
with open("CSVBank\Chase2981_Activity20240101_20241109_20241110.CSV") as fp:
    reader = csv.reader(fp, delimiter=",", quotechar='"')
    # next(reader, None)  # skip the headers
    data_read = [row for row in reader]

for col in data_read:
    print(col)

#print(data_read)